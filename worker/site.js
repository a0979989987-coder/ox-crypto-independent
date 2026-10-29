// Fixed identity of the OX 加密 Site, shared by the Worker and the GitHub data publisher.
export const PUBLIC_ORIGIN = 'https://crypto.oxpattern.com';
export const REPOSITORY = 'a0979989987-coder/ox-crypto-independent';
export const REPOSITORY_ID = '1406048637';
export const REPOSITORY_OWNER_ID = '327283790';
// GitHub signs the publisher's token for this audience; the Worker only compares it.
export const PUBLISH_AUDIENCE = PUBLIC_ORIGIN;
// Workflows on main that may publish data files to the Site.
export const DATA_WORKFLOWS = ['deploy-sites-data.yml', 'update-news.yml', 'update-macro-results.yml', 'flow-history.yml', 'record-crypto-breakouts.yml'];
// Public data files: data/*.json and previews/data/*.json (news, macro results, 4H breakouts, taker history, tool snapshots).
export const DATA_FILE = /^(?:data|previews\/data)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:json|json\.gz)$/;
export const REQUIRED_DATA = ['data/news.json', 'data/macro-results.json', 'previews/data/crypto-flow-history.json'];
