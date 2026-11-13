import '@fontsource/secular-one/hebrew-400.css';
import '@fontsource/secular-one/latin-400.css';
import '@fontsource-variable/heebo/wght.css';
import '@fontsource/playfair-display/latin-900.css';
import './styles/tokens.css';
import './styles/cards.css';
import './styles/game.css';
import './styles/screens.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';

new App(document.getElementById('app')!);

// Cache the app for offline play and update silently when a new build ships.
registerSW({ immediate: true });
