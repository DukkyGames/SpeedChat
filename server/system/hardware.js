/**
 * Hardware detection for the Models app.
 * Local probes only (no remote SSH in Minnow v1).
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import { runProcess } from '../process-runner.js';
import { parseNvidiaSmiGpu } from './vram.js';

/** 24 h — matches hardware.py CACHE_TTL; user can bypass with fresh=true. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** PowerShell probe for Windows hardware detection. */
const WINDOWS_PS_CMD = `
        $r = @{}
        $os = Get-CimInstance Win32_OperatingSystem
        $r.ram_gb = [math]::Round($os.TotalVisibleMemorySize / 1048576, 1)
        $r.avail_gb = [math]::Round($os.FreePhysicalMemory / 1048576, 1)
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        $r.cpu_name = $cpu.Name
        $r.cpu_cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
        $r.arch = $cpu.AddressWidth
        # GPU detection via nvidia-smi (fastest) or WMI fallback
        try { 
            $nv = nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits 2>$null
            if ($LASTEXITCODE -eq 0 -and $nv) { 
                $gpus = @()
                foreach ($line in $nv -split \`n) { 
                    $p = $line -split ','
                    if ($p.Count -ge 2) { $gpus += [pscustomobject]@{name = $p[1].Trim(); vram_mb = [double]$p[0].Trim() } } 
                }
                $r.gpu_name = $gpus[0].name
                $r.gpu_vram_gb = [math]::Round(($gpus | Measure-Object -Property vram_mb -Sum).Sum / 1024, 1)
                $r.gpu_count = $gpus.Count
                $r.gpu_backend = 'cuda'
                $r.gpu_list = @($gpus | ForEach-Object { @{ name = $_.name; vram_mb = $_.vram_mb } })
            } 
        }
        catch {}
        if (-not $r.gpu_name) { 
            $wmiGpu = Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object -First 1
            $GPUDriverKey = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*"
            $GPUDeviceID = $wmiGpu.PNPDeviceID.Split('&')[0..1] -join '&'
            $VRAMfromRegistry = Get-ItemProperty -Path $GPUDriverKey |
            Where-Object { $_.MatchingDeviceId -like "\${GPUDeviceID}*" } |
            # Sometimes there happen to be multiple driver classes for the same gpu.
            Select-Object -ExpandProperty HardwareInformation.qwMemorySize -ErrorAction SilentlyContinue -First 1
            if ($wmiGpu) { 
                $r.gpu_name = $wmiGpu.Name
                # Edge case: driver is broken, otherwise $wmiGpu.AdapterRAM is redundant
                if ($VRAMfromRegistry -ge $wmiGpu.AdapterRAM) {
                    $r.gpu_vram_gb = [math]::Round($VRAMfromRegistry / 1073741824, 1)
                }
                else {
                    $r.gpu_vram_gb = [math]::Round($wmiGpu.AdapterRAM / 1073741824, 1)
                }
                $r.gpu_count = 1
                # WMI doesn't tell us CUDA/ROCm
                $r.gpu_backend = 'cpu_x86';
            } 
        }
        $r | ConvertTo-Json -Compress
    `;

const NVIDIA_PATH_CANDIDATES = [
  'nvidia-smi',
  '/usr/bin/nvidia-smi',
  '/usr/local/bin/nvidia-smi',
  '/usr/local/cuda/bin/nvidia-smi',
  '/usr/lib/wsl/lib/nvidia-smi',
];

let hardwareCache = { at: 0, payload: null };

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function asInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Group identical GPUs by (name, rounded VRAM) — ports hardware.py _group_gpus.
 * @param {Array<{ index?: number, name: string, vramGb: number }>} gpus
 */
export function groupGpus(gpus) {
  /** @type {Map<string, { name: string, vramEach: number, count: number, indices: number[] }>} */
  const groups = new Map();
  const order = [];
  for (const g of gpus) {
    const key = `${g.name}|${Math.round(g.vramGb)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name: g.name,
        vramEach: Math.round(g.vramGb * 10) / 10,
        count: 0,
        indices: [],
      });
      order.push(key);
    }
    const grp = groups.get(key);
    grp.count += 1;
    grp.indices.push(g.index ?? 0);
  }
  const out = [];
  for (const key of order) {
    const grp = groups.get(key);
    out.push({
      ...grp,
      vramTotal: Math.round(grp.vramEach * grp.count * 10) / 10,
    });
  }
  out.sort((a, b) => b.vramTotal - a.vramTotal);
  return out;
}

/**
 * Map AMD gfx target to family — ports classify_amd_gfx.
 * @param {string} gfx
 * @returns {{ gfx: string, family: 'rdna' | 'cdna' | 'gcn' | 'unknown' }}
 */
export function classifyAmdGfx(gfx) {
  const normalized = (gfx || '').toLowerCase().trim();
  const m = normalized.match(/^gfx(\d+[a-f]?)$/);
  if (!m) return { gfx: '', family: 'unknown' };
  const digits = m[1];
  if (digits.startsWith('10') || digits.startsWith('11') || digits.startsWith('12')) {
    return { gfx: normalized, family: 'rdna' };
  }
  if (digits === '908' || digits === '90a' || digits.startsWith('94') || digits.startsWith('95')) {
    return { gfx: normalized, family: 'cdna' };
  }
  if (digits.startsWith('9')) {
    return { gfx: normalized, family: 'gcn' };
  }
  return { gfx: normalized, family: 'unknown' };
}

/**
 * @param {string} stdout
 * @returns {string | null}
 */
function detectNvidiaDriverError(stdout) {
  const low = (stdout || '').toLowerCase();
  if (
    low.includes('nvml') ||
    low.includes('driver/library version mismatch') ||
    low.includes("couldn't communicate") ||
    low.includes('no devices were found') ||
    low.includes('failed to initialize')
  ) {
    return (stdout || '').trim().split('\n')[0]?.slice(0, 140) || 'NVIDIA driver error';
  }
  return null;
}

/**
 * @param {number} totalRamGb
 * @returns {Promise<{ gpuName: string, gpuVramGb: number, gpuCount: number, gpus: object[], gpuGroups: object[], homogeneous: boolean, backend: string, unifiedMemory?: boolean, gpuFamily?: string } | { gpuError: string } | null>}
 */
async function detectNvidia(totalRamGb) {
  let stdout = '';
  for (const bin of NVIDIA_PATH_CANDIDATES) {
    try {
      const { code, stdout: out } = await runProcess(
        bin,
        ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'],
        { timeout: 10_000 },
      );
      if (code === 0 && out?.trim()) {
        stdout = out;
        break;
      }
    } catch {
      /* try next candidate */
    }
  }

  if (!stdout.trim()) return null;

  const driverError = detectNvidiaDriverError(stdout);
  if (driverError) return { gpuError: driverError };

  const parsed = parseNvidiaSmiGpu(stdout);
  if (!parsed.available) {
    if (parsed.unified?.length) {
      const ramGb = Math.round(totalRamGb * 10) / 10;
      const gpus = parsed.unified.map((g) => ({
        index: g.index,
        name: g.name,
        vramGb: ramGb,
      }));
      return {
        gpuName: gpus[0].name,
        gpuVramGb: ramGb,
        gpuCount: gpus.length,
        gpus,
        gpuGroups: groupGpus(gpus),
        homogeneous: true,
        backend: 'cuda',
        unifiedMemory: true,
      };
    }
    return null;
  }

  const totalVram = parsed.gpus.reduce((sum, g) => sum + g.vramGb, 0);
  const gpuGroups = groupGpus(parsed.gpus);
  return {
    gpuName: parsed.gpus[0].name,
    gpuVramGb: Math.round(totalVram * 10) / 10,
    gpuCount: parsed.gpus.length,
    gpus: parsed.gpus,
    gpuGroups,
    homogeneous: gpuGroups.length <= 1,
    backend: 'cuda',
    unifiedMemory: false,
  };
}

/**
 * @param {string} path
 */
async function readSysFile(path) {
  try {
    const { readFile } = await import('node:fs/promises');
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ gpuName: string, gpuVramGb: number, gpuCount: number, gpus: object[], gpuGroups: object[], homogeneous: boolean, backend: string, unifiedMemory?: boolean, gpuFamily?: string } | null>}
 */
async function detectAmd() {
  const { readdir } = await import('node:fs/promises');
  let entries = [];
  try {
    entries = await readdir('/sys/class/drm');
  } catch {
    return null;
  }

  const cards = [];
  let isApu = false;
  let cardIndex = 0;
  for (const entry of entries) {
    if (!entry.startsWith('card') || entry.includes('-')) continue;
    const base = `/sys/class/drm/${entry}/device`;
    const vendor = await readSysFile(`${base}/vendor`);
    if (vendor !== '0x1002') continue;

    const vramRaw = await readSysFile(`${base}/mem_info_vram_total`);
    const visRaw = await readSysFile(`${base}/mem_info_vis_vram_total`);
    const gttRaw = await readSysFile(`${base}/mem_info_gtt_total`);
    const vramVal = vramRaw && /^\d+$/.test(vramRaw) ? Number(vramRaw) : 0;
    const visVal = visRaw && /^\d+$/.test(visRaw) ? Number(visRaw) : 0;
    const gttVal = gttRaw && /^\d+$/.test(gttRaw) ? Number(gttRaw) : 0;
    let vramBytes = Math.max(vramVal, visVal);
    if (vramBytes <= 0) vramBytes = gttVal;
    if (visVal && visVal >= vramVal) isApu = true;
    if (vramBytes <= 0) continue;

    const name = (await readSysFile(`${base}/product_name`)) || `AMD GPU (${entry})`;
    cards.push({
      index: cardIndex,
      name,
      vramGb: vramBytes / 1024 ** 3,
    });
    cardIndex += 1;
  }

  if (!cards.length) return null;

  let gfx = '';
  let family = 'unknown';
  try {
    const { code, stdout } = await runProcess('rocminfo', [], { timeout: 10_000 });
    const info = code === 0 ? stdout : '';
    const alt = info || (await runProcess('/opt/rocm/bin/rocminfo', [], { timeout: 10_000 })).stdout || '';
    const m = alt.match(/gfx\d+[a-f]?/);
    ({ gfx, family } = classifyAmdGfx(m?.[0] ?? ''));
  } catch {
    /* rocminfo optional */
  }

  const totalVram = cards.reduce((sum, c) => sum + c.vramGb, 0);
  const gpuGroups = groupGpus(cards);
  return {
    gpuName: cards[0].name,
    gpuVramGb: Math.round(totalVram * 10) / 10,
    gpuCount: cards.length,
    gpus: cards,
    gpuGroups,
    homogeneous: gpuGroups.length <= 1,
    backend: 'rocm',
    unifiedMemory: isApu,
    gpuFamily: family,
  };
}

/**
 * @returns {Promise<{ gpuName: string, gpuVramGb: number, gpuCount: number, gpus: object[], gpuGroups: object[], homogeneous: boolean, backend: string, unifiedMemory: boolean } | null>}
 */
async function detectAppleSilicon() {
  if (process.platform !== 'darwin') return null;
  const arch = os.arch().toLowerCase();
  if (!arch.includes('arm') && arch !== 'aarch64') return null;

  let brand = 'Apple Silicon';
  try {
    const { code, stdout } = await runProcess('sysctl', ['-n', 'machdep.cpu.brand_string'], {
      timeout: 10_000,
    });
    if (code === 0 && stdout?.trim()) brand = stdout.trim();
  } catch {
    /* sysctl optional */
  }

  let totalGb = 0;
  try {
    const { code, stdout } = await runProcess('sysctl', ['-n', 'hw.memsize'], { timeout: 10_000 });
    if (code === 0 && stdout?.trim()) totalGb = Number(stdout) / 1024 ** 3;
  } catch {
    return null;
  }
  if (totalGb <= 0) return null;

  let frac = 0.8;
  if (totalGb <= 16) frac = 0.67;
  else if (totalGb <= 64) frac = 0.75;
  let vramGb = Math.round(totalGb * frac * 10) / 10;

  try {
    const { code, stdout } = await runProcess('sysctl', ['-n', 'iogpu.wired_limit_mb'], {
      timeout: 10_000,
    });
    if (code === 0 && stdout?.trim()) {
      const wiredMb = Number(stdout);
      if (wiredMb > 0) vramGb = Math.round((wiredMb / 1024) * 10) / 10;
    }
  } catch {
    /* wired limit optional */
  }

  const gpu = { index: 0, name: brand, vramGb };
  const gpus = [gpu];
  return {
    gpuName: brand,
    gpuVramGb: vramGb,
    gpuCount: 1,
    gpus,
    gpuGroups: groupGpus(gpus),
    homogeneous: true,
    backend: 'metal',
    unifiedMemory: true,
  };
}

/**
 * @returns {Promise<object | null>}
 */
function resolvePowershellExe() {
  if (process.platform === 'win32') {
    try {
      const pwsh = execSync('where pwsh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split(/\r?\n/)[0];
      if (pwsh) return pwsh;
    } catch {
      /* fall through */
    }
    try {
      const ps = execSync('where powershell', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split(/\r?\n/)[0];
      if (ps) return ps;
    } catch {
      /* fall through */
    }
    return 'powershell';
  }
  return 'pwsh';
}

async function detectWindows() {
  const powershellExe = resolvePowershellExe();

  let out = '';
  try {
    const result = await runProcess(
      powershellExe,
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PS_CMD],
      { timeout: 10_000 },
    );
    if (result.code === 0) out = result.stdout?.trim() ?? '';
  } catch {
    return null;
  }
  if (!out) return null;

  try {
    const d = JSON.parse(out);
    const cpuName = String(d.cpu_name ?? 'unknown').trim() || 'unknown';
    const result = {
      totalRamGb: Number(d.ram_gb) || 0,
      availableRamGb: Number(d.avail_gb) || 0,
      cpuCores: asInt(d.cpu_cores, 1),
      cpuName,
      hasGpu: Boolean(d.gpu_name),
      gpuName: d.gpu_name ?? null,
      gpuVramGb: d.gpu_vram_gb ?? null,
      gpuCount: asInt(d.gpu_count, 0),
      backend: d.gpu_backend || 'cpu_x86',
      homogeneous: true,
      gpuError: null,
      platform: 'windows',
      arch: d.arch ? `${d.arch}` : 'x64',
    };

    const listed = Array.isArray(d.gpu_list) ? d.gpu_list : [];
    if (result.hasGpu && listed.length > 0) {
      result.gpus = listed.map((gpu, i) => {
        const vramMb = Number(gpu?.vram_mb);
        return {
          index: i,
          name: typeof gpu?.name === 'string' && gpu.name.trim() ? gpu.name.trim() : result.gpuName,
          vramGb: Number.isFinite(vramMb) ? Math.round((vramMb / 1024) * 10) / 10 : 0,
        };
      });
      result.gpuCount = result.gpus.length;
      result.gpuVramGb = Math.round(result.gpus.reduce((sum, g) => sum + g.vramGb, 0) * 10) / 10;
      result.gpuName = result.gpus[0].name;
      result.gpuGroups = groupGpus(result.gpus);
      result.homogeneous = result.gpuGroups.length <= 1;
      result.unifiedMemory = false;
    } else {
      const n = result.gpuCount || 0;
      if (result.hasGpu && n > 0) {
        const each = Math.round(((result.gpuVramGb || 0) / n) * 10) / 10;
        result.gpus = Array.from({ length: n }, (_, i) => ({
          index: i,
          name: result.gpuName,
          vramGb: each,
        }));
        result.gpuGroups = [
          {
            name: result.gpuName,
            vramEach: each,
            count: n,
            indices: Array.from({ length: n }, (_, i) => i),
            vramTotal: result.gpuVramGb,
          },
        ];
        result.homogeneous = true;
        result.unifiedMemory = false;
      }
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Normalize a partial hardware dict into the scorer-facing shape.
 * @param {Record<string, unknown>} partial
 */
function finalizeHardware(partial) {
  const platform =
    partial.platform ||
    (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux');
  return {
    os: platform === 'windows' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux',
    platform,
    arch: partial.arch || os.arch(),
    cpuName: partial.cpuName || os.cpus()[0]?.model || 'unknown',
    cpuCores: partial.cpuCores || os.cpus().length || 1,
    totalRamGb: Math.round((partial.totalRamGb ?? os.totalmem() / 1024 ** 3) * 10) / 10,
    availableRamGb:
      Math.round((partial.availableRamGb ?? os.freemem() / 1024 ** 3) * 10) / 10,
    hasGpu: Boolean(partial.hasGpu),
    gpuName: partial.gpuName ?? null,
    gpuVramGb: partial.gpuVramGb ?? null,
    gpuCount: partial.gpuCount ?? 0,
    gpus: partial.gpus ?? [],
    gpuGroups: partial.gpuGroups ?? [],
    homogeneous: partial.homogeneous ?? true,
    backend: partial.backend || 'cpu_x86',
    unifiedMemory: Boolean(partial.unifiedMemory),
    gpuFamily: partial.gpuFamily ?? null,
    gpuError: partial.gpuError ?? null,
    detectedAt: Date.now(),
  };
}

/**
 * Detect local hardware for model fit scoring.
 * @param {{ fresh?: boolean }} [options]
 */
export async function detectHardware({ fresh } = {}) {
  const now = Date.now();
  if (!fresh && hardwareCache.payload && now - hardwareCache.at < CACHE_TTL_MS) {
    return hardwareCache.payload;
  }

  if (process.platform === 'win32') {
    const win = await detectWindows();
    if (win) {
      const payload = finalizeHardware(win);
      hardwareCache = { at: now, payload };
      return payload;
    }
  }

  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const availableRamGb = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;
  const cpuCores = os.cpus().length || 1;
  const cpuName = os.cpus()[0]?.model || 'unknown';

  const apple = await detectAppleSilicon();
  const nvidia = apple ? null : await detectNvidia(totalRamGb);
  const amd = apple || nvidia ? null : await detectAmd();

  /** @type {Record<string, unknown>} */
  let partial = {
    totalRamGb,
    availableRamGb,
    cpuCores,
    cpuName,
    platform:
      process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux',
  };

  if (nvidia && 'gpuError' in nvidia) {
    partial = {
      ...partial,
      hasGpu: false,
      gpuName: null,
      gpuVramGb: null,
      gpuCount: 0,
      backend: os.arch().includes('arm') ? 'cpu_arm' : 'cpu_x86',
      gpuError: nvidia.gpuError,
    };
  } else if (apple || (nvidia && !('gpuError' in nvidia)) || amd) {
    const gpu = apple || nvidia || amd;
    partial = {
      ...partial,
      hasGpu: true,
      gpuName: gpu.gpuName,
      gpuVramGb: gpu.gpuVramGb,
      gpuCount: gpu.gpuCount,
      gpus: gpu.gpus,
      gpuGroups: gpu.gpuGroups,
      homogeneous: gpu.homogeneous,
      backend: gpu.backend,
      unifiedMemory: gpu.unifiedMemory ?? false,
      gpuFamily: gpu.gpuFamily ?? null,
      gpuError: null,
    };
  } else {
    const arch = os.arch().toLowerCase();
    partial = {
      ...partial,
      hasGpu: false,
      gpuName: null,
      gpuVramGb: null,
      gpuCount: 0,
      backend: arch.includes('arm') || arch === 'aarch64' ? 'cpu_arm' : 'cpu_x86',
      gpuError: null,
    };
  }

  const payload = finalizeHardware(partial);
  hardwareCache = { at: now, payload };
  return payload;
}

/** Test helper — reset in-module cache. */
export function clearHardwareCacheForTests() {
  hardwareCache = { at: 0, payload: null };
}
