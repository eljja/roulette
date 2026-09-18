import './localization';

import { AvatarManager } from './avatarManager';
import { MapEditorUI } from './editor/mapEditorUI';
import { deleteCustomMapFromLocal, importMapFromUrl, loadCustomMapsFromLocal } from './editor/mapSerializer';
import options from './options';
import { Roulette } from './roulette';

const roulette = new Roulette();

(window as any).roulette = roulette;
(window as any).options = options;
(window as any).MapEditorUI = MapEditorUI;
(window as any).importMapFromUrl = importMapFromUrl;
(window as any).loadCustomMapsFromLocal = loadCustomMapsFromLocal;
(window as any).deleteCustomMapFromLocal = deleteCustomMapFromLocal;
(window as any).AvatarManager = AvatarManager;
