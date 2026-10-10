/**
 * Which build this is: the live site, or the staging copy that previews a
 * change before it ships.
 *
 * Staging is served from the same origin as the live site — both live on
 * basta.github.io — so the two share one `localStorage`. Every storage key is
 * prefixed by channel, so nothing staging does can rewrite a plan the live
 * site depends on.
 */
export type Channel = 'live' | 'staging';

// `import.meta.env` is Vite's; under plain Node (scripts, tools) it is absent,
// and that is the live channel.
export const CHANNEL: Channel = import.meta.env?.VITE_CHANNEL === 'staging' ? 'staging' : 'live';

export const storagePrefix = (channel: Channel): string =>
  channel === 'staging' ? 'factory-graph-staging:' : 'factory-graph:';
