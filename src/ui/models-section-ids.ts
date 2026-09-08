export type ModelsSectionId =
  | 'installed'
  | 'recommend'
  | 'server'
  | 'settings'
  | 'voice'
  | 'providers'
  | 'routing'
  | 'routers'
  | 'sampler'
  | 'thinking'
  | 'usage';

export const MODELS_SECTIONS: ModelsSectionId[] = [
  'installed',
  'recommend',
  'server',
  'settings',
  'voice',
  'providers',
  'routing',
  'routers',
  'sampler',
  'thinking',
  'usage',
];

/** Landing section — your own models, not the catalog. */
export const DEFAULT_MODELS_SECTION: ModelsSectionId = 'installed';

export const MODELS_SECTION_LABELS: Record<ModelsSectionId, string> = {
  installed: 'My models',
  recommend: 'Discover',
  server: 'Local server',
  settings: 'Storage',
  voice: 'Voice',
  providers: 'Providers',
  routing: 'Routing',
  routers: 'Routers',
  sampler: 'Sampler',
  thinking: 'Thinking',
  usage: 'Usage & cost',
};

/** Sections that render the workbench chrome (rail + inspector). */
export const WORKBENCH_SECTIONS = new Set<ModelsSectionId>(['installed', 'recommend', 'server']);
