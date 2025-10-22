import openaiLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import factoryLogo from '../../assets/images/factorydroid.png';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import qwenLogo from '../../assets/images/qwen.png';
import augmentLogo from '../../assets/images/augmentcode.png';
import type { UiProvider } from './meta';

export type ProviderAsset = { logo: string; alt: string; invertInDark?: boolean; name: string };

export const providerAssets: Record<UiProvider, ProviderAsset> = {
  codex: { name: 'OpenAI', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code CLI' },
  claude: { name: 'Anthropic', logo: claudeLogo, alt: 'Claude Code' },
  droid: { name: 'Factory AI', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  gemini: { name: 'Google', logo: geminiLogo, alt: 'Gemini CLI' },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  copilot: { name: 'GitHub', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  amp: { name: 'Sourcegraph', logo: ampLogo, alt: 'Amp CLI' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode CLI', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm CLI' },
  auggie: { name: 'Augment Code', logo: augmentLogo, alt: 'Auggie CLI' },
};
