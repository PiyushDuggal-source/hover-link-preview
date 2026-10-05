// Shared defaults: loaded by the content script (manifest) and the options page.
// Domain lists are one domain per line; '#' starts a comment; subdomains are included.
const HLP_DEFAULT_EXCLUDED = [
  '# Social networks & messengers (extension is off while you browse these)',
  'instagram.com',
  'facebook.com',
  'messenger.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'threads.net',
  'tiktok.com',
  'snapchat.com',
  'pinterest.com',
  'tumblr.com',
  'whatsapp.com',
  'telegram.org',
  'discord.com',
].join('\n');

const HLP_DEFAULTS = {
  enabled: true,
  delaySec: 5,
  size: 'medium',
  keepOnScreen: false,
  listMode: 'deny',
  domains: '', // link-destination list (deny/allow, see listMode)
  excludedSites: HLP_DEFAULT_EXCLUDED, // pages on which the extension does nothing
};
