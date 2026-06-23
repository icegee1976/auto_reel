import cors from "cors";
import express from "express";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fsSync from "fs";
import fs from "fs/promises";
import multer from "multer";
import { nanoid } from "nanoid";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const jobsDir = path.join(dataDir, "jobs");
const outputsDir = path.join(dataDir, "outputs");
const manifestPath = path.join(uploadDir, "manifest.json");
const distDir = path.join(rootDir, "dist");

const app = express();
const port = Number(process.env.PORT || 4100);
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || ffprobeStatic.path || "ffprobe";

const visualExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);

await ensureBaseDirs();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: 80,
    fileSize: 1024 * 1024 * 1024
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath
  });
});

app.get("/api/library", async (_req, res) => {
  res.json({ files: await readManifest() });
});

app.post("/api/upload", upload.array("files"), async (req, res, next) => {
  try {
    const incoming = req.files || [];
    const manifest = await readManifest();
    const items = [];

    for (const file of incoming) {
      const ext = path.extname(file.originalname || file.filename).toLowerCase();
      const kind = classifyFile(file.mimetype, ext);

      if (!kind) {
        await fs.unlink(file.path).catch(() => {});
        continue;
      }

      const meta = await probeMedia(file.path).catch(() => null);
      const item = {
        id: nanoid(12),
        originalName: file.originalname,
        storedName: file.filename,
        ext,
        kind,
        size: file.size,
        duration: meta?.duration || null,
        width: meta?.width || null,
        height: meta?.height || null,
        createdAt: new Date().toISOString()
      };

      manifest.push(item);
      items.push(item);
    }

    await writeManifest(manifest);
    res.json({ files: items });
  } catch (error) {
    next(error);
  }
});

app.post("/api/render", async (req, res, next) => {
  try {
    const payload = req.body || {};
    const manifest = await readManifest();
    const fileMap = new Map(manifest.map((item) => [item.id, item]));
    const visuals = normalizeVisuals(payload.visuals || [], fileMap);
    const audio = normalizeAudio(payload.audio || [], fileMap);
    const settings = normalizeSettings(payload.settings || {});

    if (!visuals.length) {
      res.status(400).json({ error: "至少需要一個圖片或影片素材。" });
      return;
    }

    const jobId = nanoid(12);
    const jobDir = path.join(jobsDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const rendered = [];
    for (let index = 0; index < visuals.length; index += 1) {
      const result = await renderSegment(visuals[index], index, settings, jobDir);
      rendered.push(result);
    }

    const listPath = path.join(jobDir, "segments.txt");
    await fs.writeFile(listPath, rendered.map((item) => `file '${toConcatPath(item.path)}'`).join("\n"), "utf8");

    const silentVideoPath = path.join(jobDir, "silent.mp4");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", silentVideoPath], "concat scenes");

    const totalDuration = rendered.reduce((sum, item) => sum + item.duration, 0);
    const outputName = `${settings.outputName || "auto-reel"}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
    const outputPath = path.join(outputsDir, outputName);

    if (audio.length) {
      const musicTrack = await prepareMusicTrack(audio, totalDuration, settings, jobDir);
      const fadeDuration = Math.min(1.5, Math.max(0.2, totalDuration / 4));
      const fadeStart = Math.max(0, totalDuration - fadeDuration);
      const audioFilter = buildAudioFilter(settings, fadeStart, fadeDuration);
      await runFfmpeg(
        [
          "-y",
          "-i",
          silentVideoPath,
          "-stream_loop",
          "-1",
          "-i",
          musicTrack,
          "-t",
          fixed(totalDuration),
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-af",
          audioFilter,
          "-shortest",
          "-movflags",
          "+faststart",
          outputPath
        ],
        "add music"
      );
    } else {
      await fs.copyFile(silentVideoPath, outputPath);
    }

    res.json({
      jobId,
      file: outputName,
      url: `/api/outputs/${encodeURIComponent(outputName)}`,
      duration: totalDuration,
      scenes: rendered.length,
      width: settings.width,
      height: settings.height
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/outputs/:file", async (req, res) => {
  const safeName = path.basename(req.params.file);
  res.sendFile(path.join(outputsDir, safeName));
});

app.get("/api/uploads/:file", async (req, res) => {
  const safeName = path.basename(req.params.file);
  res.sendFile(path.join(uploadDir, safeName));
});

if (process.env.NODE_ENV === "production" && fsSync.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error.message || "Render failed"
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Auto Reel API listening on http://127.0.0.1:${port}`);
});

async function ensureBaseDirs() {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(jobsDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });
  if (!fsSync.existsSync(manifestPath)) {
    await fs.writeFile(manifestPath, "[]", "utf8");
  }
}

function classifyFile(mimetype, ext) {
  if (mimetype?.startsWith("image/") || imageExtensions.has(ext)) return "image";
  if (mimetype?.startsWith("video/") || (visualExtensions.has(ext) && !imageExtensions.has(ext))) return "video";
  if (mimetype?.startsWith("audio/") || audioExtensions.has(ext)) return "audio";
  return null;
}

async function readManifest() {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeManifest(items) {
  await fs.writeFile(manifestPath, JSON.stringify(items, null, 2), "utf8");
}

function normalizeVisuals(visuals, fileMap) {
  return visuals
    .map((asset) => {
      const stored = fileMap.get(asset.id);
      if (!stored || !["image", "video"].includes(stored.kind)) return null;
      const sourceDuration = Number(stored.duration) || null;
      const duration = clamp(Number(asset.duration) || sourceDuration || 4, 0.4, 120);
      const trimStart = clamp(Number(asset.trimStart) || 0, 0, Math.max(0, (sourceDuration || duration) - 0.2));
      const motion = asset.motion === "zoom" ? "zoomIn" : asset.motion;
      return {
        ...stored,
        path: path.join(uploadDir, stored.storedName),
        sourceDuration,
        duration,
        trimStart,
        fit: ["cover", "contain"].includes(asset.fit) ? asset.fit : "cover",
        motion: ["still", "zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"].includes(motion) ? motion : "zoomIn",
        transitionEffect: ["none", "fade", "dipBlack", "flashWhite"].includes(asset.transitionEffect)
          ? asset.transitionEffect
          : "fade",
        transition: clamp(Number(asset.transition) || 0, 0, 1.2)
      };
    })
    .filter(Boolean);
}

function normalizeAudio(audio, fileMap) {
  return audio
    .map((asset) => fileMap.get(asset.id))
    .filter((asset) => asset?.kind === "audio")
    .map((asset) => ({
      ...asset,
      path: path.join(uploadDir, asset.storedName)
    }));
}

function normalizeSettings(settings) {
  const aspect = ["reel", "square", "wide"].includes(settings.aspect) ? settings.aspect : "reel";
  const resolution = ["preview", "standard", "full"].includes(settings.resolution) ? settings.resolution : "full";
  const visualOptimize = ["off", "natural", "bright", "vivid"].includes(settings.visualOptimize) ? settings.visualOptimize : "off";
  const audioDenoise = ["off", "light", "medium", "strong"].includes(settings.audioDenoise) ? settings.audioDenoise : "off";
  const vocalMode = ["none", "remove", "enhance"].includes(settings.vocalMode) ? settings.vocalMode : "none";
  const sizes = {
    reel: {
      preview: [540, 960],
      standard: [720, 1280],
      full: [1080, 1920]
    },
    square: {
      preview: [720, 720],
      standard: [1080, 1080],
      full: [1440, 1440]
    },
    wide: {
      preview: [960, 540],
      standard: [1280, 720],
      full: [1920, 1080]
    }
  };
  const [width, height] = sizes[aspect][resolution];

  return {
    aspect,
    resolution,
    width,
    height,
    fps: clamp(Number(settings.fps) || 30, 24, 60),
    background: sanitizeColor(settings.background || "#111214"),
    visualOptimize,
    audioDenoise,
    vocalMode,
    musicVolume: clamp(numberOrDefault(settings.musicVolume, 0.82), 0, 2),
    outputName: slugify(settings.outputName || "auto-reel")
  };
}

async function renderSegment(asset, index, settings, jobDir) {
  const outPath = path.join(jobDir, `scene-${String(index + 1).padStart(3, "0")}.mp4`);
  const duration = fixed(asset.duration);
  const filter = buildVideoFilter(asset, settings);
  const args = ["-y"];

  if (asset.kind === "image") {
    args.push("-loop", "1", "-t", duration, "-i", asset.path);
  } else {
    const sourceDuration = Number(asset.sourceDuration) || 0;
    const canLoop = Number(asset.duration) > 0 && Number(asset.duration) > sourceDuration + 0.2;
    if (canLoop) args.push("-stream_loop", "-1");
    if (asset.trimStart > 0) args.push("-ss", fixed(asset.trimStart));
    args.push("-i", asset.path, "-t", duration);
  }

  args.push(
    "-vf",
    filter,
    "-r",
    String(settings.fps),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath
  );

  await runFfmpeg(args, `render scene ${index + 1}`);
  return {
    path: outPath,
    duration: Number(duration)
  };
}

function buildVideoFilter(asset, settings) {
  const { width, height, fps, background } = settings;
  const baseParts = buildImageMotionFilter(asset, width, height, fps, background);
  const optimizeParts = buildVisualOptimizeFilters(settings.visualOptimize);
  const transitionParts = buildTransitionFilters(asset);

  return [...baseParts, ...optimizeParts, ...transitionParts, "format=yuv420p"].join(",");
}

function buildImageMotionFilter(asset, width, height, fps, background) {
  if (asset.kind !== "image" || asset.fit === "contain" || asset.motion === "still") {
    if (asset.fit === "contain") {
      return [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`,
        `fps=${fps}`,
        "setsar=1"
      ];
    }

    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${fps}`,
      "setsar=1"
    ];
  }

  const frames = Math.max(1, Math.round(asset.duration * fps));
  const motionCanvasWidth = Math.ceil(width * 1.12);
  const motionCanvasHeight = Math.ceil(height * 1.12);

  if (asset.motion === "zoomIn" || asset.motion === "zoomOut") {
    const zoomExpression = asset.motion === "zoomIn"
      ? `'1+0.08*on/${frames}'`
      : `'1.08-0.08*on/${frames}'`;

    return [
      `scale=${motionCanvasWidth}:${motionCanvasHeight}:force_original_aspect_ratio=increase`,
      `crop=${motionCanvasWidth}:${motionCanvasHeight}`,
      `zoompan=z=${zoomExpression}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
      "setsar=1"
    ];
  }

  const xByMotion = {
    panLeft: `'(iw-ow)*n/${frames}'`,
    panRight: `'(iw-ow)*(1-n/${frames})'`,
    panUp: "'(iw-ow)/2'",
    panDown: "'(iw-ow)/2'"
  };
  const yByMotion = {
    panLeft: "'(ih-oh)/2'",
    panRight: "'(ih-oh)/2'",
    panUp: `'(ih-oh)*n/${frames}'`,
    panDown: `'(ih-oh)*(1-n/${frames})'`
  };

  return [
    `scale=${motionCanvasWidth}:${motionCanvasHeight}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:${xByMotion[asset.motion] || "'(iw-ow)/2'"}:${yByMotion[asset.motion] || "'(ih-oh)/2'"}`,
    `fps=${fps}`,
    "setsar=1"
  ];
}

function buildVisualOptimizeFilters(mode) {
  const filters = {
    natural: ["eq=brightness=0.02:contrast=1.08:saturation=1.12:gamma=0.98", "unsharp=5:5:0.35:3:3:0.08"],
    bright: ["eq=brightness=0.05:contrast=1.06:saturation=1.08:gamma=0.95", "unsharp=5:5:0.28:3:3:0.06"],
    vivid: ["eq=brightness=0.025:contrast=1.14:saturation=1.22:gamma=0.97", "unsharp=5:5:0.45:3:3:0.1"]
  };

  return filters[mode] || [];
}

function buildTransitionFilters(asset) {
  const transition = Math.min(asset.transition, Math.max(0, asset.duration / 3));
  if (asset.transitionEffect === "none" || transition <= 0.01) return [];

  const fadeOutStart = Math.max(0, asset.duration - transition);
  const colorByEffect = {
    fade: "black",
    dipBlack: "black",
    flashWhite: "white"
  };
  const color = colorByEffect[asset.transitionEffect] || "black";

  return [
    `fade=t=in:st=0:d=${fixed(transition)}:color=${color}`,
    `fade=t=out:st=${fixed(fadeOutStart)}:d=${fixed(transition)}:color=${color}`
  ];
}

function buildAudioFilter(settings, fadeStart, fadeDuration) {
  const filters = [];

  if (settings.audioDenoise !== "off") {
    const reductionByMode = {
      light: 8,
      medium: 14,
      strong: 22
    };
    filters.push(`afftdn=nr=${reductionByMode[settings.audioDenoise] || 14}:nf=-25`);
  }

  if (settings.vocalMode === "remove") {
    filters.push("pan=stereo|c0=c0-c1|c1=c1-c0");
  } else if (settings.vocalMode === "enhance") {
    filters.push(
      "highpass=f=90",
      "lowpass=f=12000",
      "equalizer=f=180:t=q:w=1:g=-2",
      "equalizer=f=3200:t=q:w=1.2:g=4",
      "dynaudnorm=f=150:g=12"
    );
  }

  filters.push(`volume=${fixed(settings.musicVolume)}`);
  filters.push(`afade=t=out:st=${fixed(fadeStart)}:d=${fixed(fadeDuration)}`);
  return filters.join(",");
}

async function prepareMusicTrack(audio, totalDuration, settings, jobDir) {
  const normalized = [];

  for (let index = 0; index < audio.length; index += 1) {
    const outPath = path.join(jobDir, `music-${String(index + 1).padStart(2, "0")}.m4a`);
    await runFfmpeg(
      [
        "-y",
        "-i",
        audio[index].path,
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outPath
      ],
      `normalize music ${index + 1}`
    );
    const meta = await probeMedia(outPath).catch(() => null);
    normalized.push({
      path: outPath,
      duration: meta?.duration || audio[index].duration || 30
    });
  }

  const list = [];
  let cursor = 0;
  while (cursor < totalDuration + 2 && normalized.length) {
    for (const item of normalized) {
      list.push(item.path);
      cursor += Number(item.duration) || 30;
      if (cursor >= totalDuration + 2) break;
    }
  }

  const listPath = path.join(jobDir, "music-list.txt");
  await fs.writeFile(listPath, list.map((item) => `file '${toConcatPath(item)}'`).join("\n"), "utf8");
  const playlistPath = path.join(jobDir, "music-playlist.m4a");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", playlistPath], "concat music");
  return playlistPath;
}

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true
    });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed during ${label}.\n${stderr}`));
      }
    });
  });
}

function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe exited with ${code}`));
        return;
      }

      const data = JSON.parse(stdout || "{}");
      const videoStream = data.streams?.find((stream) => stream.codec_type === "video");
      const audioStream = data.streams?.find((stream) => stream.codec_type === "audio");
      resolve({
        duration: Number(data.format?.duration || videoStream?.duration || audioStream?.duration) || null,
        width: Number(videoStream?.width) || null,
        height: Number(videoStream?.height) || null
      });
    });
  });
}

function sanitizeColor(value) {
  const match = String(value).trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `0x${match[1]}` : "0x111214";
}

function fixed(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "auto-reel";
}

function toConcatPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/").replace(/'/g, "'\\''");
}
