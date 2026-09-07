export const LLAMA_SPLIT_MODES: readonly ['none', 'layer', 'tensor'];

export interface LlamaGpuDevice {
  id: string;
  name: string;
  memoryMiB: number;
  freeMiB: number | null;
}

export function isGpuLlamaDeviceId(id: unknown): boolean;
export function devicePrefixForVariant(variant: string | null | undefined): string;
export function parseLlamaListDevices(text: string): LlamaGpuDevice[];
export function synthesizeLlamaDevices(
  hardware: Record<string, unknown> | null | undefined,
  variant: string | null | undefined,
): LlamaGpuDevice[];
export function resolveLlamaDeviceInventory(
  listed: Array<{ id: string }> | null | undefined,
  hardware: Record<string, unknown> | null | undefined,
  variant: string | null | undefined,
): LlamaGpuDevice[];
export function parseDeviceList(value: unknown): string[];
export function joinDeviceList(ids: string[]): string;
export function parseTensorSplit(value: unknown): number[];
export function joinTensorSplit(parts: number[]): string;
export function vramProportionalSplit(devices: Array<{ memoryMiB?: number }>): number[];
export function tensorSplitPercents(parts: number[]): number[];
export function toggleDeviceSelection(selected: string[], id: string, checked: boolean): string[];
export function resolveLaunchDevices(opts: {
  requestedDevice?: unknown;
  inventory?: Array<{ id: string }>;
  extraHasDevice?: boolean;
}): { ids: string[]; emit: boolean; reason: 'extra' | 'user' | 'pin-first' | 'omit' };
export function selectedGpuVramGb(
  inventory: Array<{ id: string; memoryMiB?: number }>,
  selectedIds: string[],
): number;
