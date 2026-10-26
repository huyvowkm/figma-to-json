figma.showUI(__html__, {
  width: 440,
  height: 480,
  themeColors: true,
});

const exportableNodeTypes = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);
type ConnectionMode = 'local-server' | 'download';

function getExportableSelection(): SceneNode[] {
  return figma.currentPage.selection.filter((node) => exportableNodeTypes.has(node.type));
}

function postSelectionSummary(): void {
  const exportableNodes = getExportableSelection();
  figma.ui.postMessage({
    type: 'selection-summary',
    selectedCount: figma.currentPage.selection.length,
    exportableCount: exportableNodes.length,
    visibleExportableCount: exportableNodes.filter(isEffectivelyVisible).length,
  });
}

figma.on('selectionchange', postSelectionSummary);

figma.ui.onmessage = async (message: {
  type?: string;
  bridge?: string;
  token?: string;
  exportMode?: 'visible-only' | 'no-filter';
  includeAssets?: boolean;
  connectionMode?: ConnectionMode;
}) => {
  if (message.type === 'get-connection-mode') {
    try {
      const savedMode = await figma.clientStorage.getAsync('connection-mode');
      figma.ui.postMessage({
        type: 'connection-mode',
        connectionMode: savedMode === 'download' ? 'download' : 'local-server',
      });
    } catch {
      figma.ui.postMessage({ type: 'connection-mode', connectionMode: 'local-server' });
    }
    return;
  }
  if (message.type === 'set-connection-mode') {
    await figma.clientStorage.setAsync(
      'connection-mode',
      message.connectionMode === 'download' ? 'download' : 'local-server',
    );
    return;
  }
  if (message.type === 'selection-summary-request') {
    postSelectionSummary();
    return;
  }
  if (message.type === 'toggle-manual') {
    figma.ui.resize(440, (message as { open?: boolean }).open ? 620 : 480);
    return;
  }
  if (message.type === 'scan-bridges') {
    figma.notify('Scanning local Figma MCP folders…');
    const errors: string[] = [];
    const projects = (await Promise.all(Array.from({ length: 21 }, async (_, index) => {
      const port = 3847 + index;
      try {
        const response = await Promise.race([
          fetch(`http://localhost:${port}/health`),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), 800)),
        ]);
        return response.ok ? await response.json() : null;
      } catch (error) { if (port === 3847) errors.push(String(error)); return null; }
    }))).filter(Boolean);
    figma.notify(projects.length ? `Found ${projects.length} local folder connection${projects.length === 1 ? '' : 's'}.` : 'No local Figma MCP folder was reachable.');
    figma.ui.postMessage({ type: 'bridge-results', projects, errors });
    return;
  }
  if (message.type !== 'export-selection') return;

  const connectionMode: ConnectionMode = message.connectionMode === 'download' ? 'download' : 'local-server';
  if (connectionMode === 'local-server' && (!message.bridge || !message.token)) {
    figma.ui.postMessage({
      type: 'export-error',
      error: 'Select a local folder before exporting in Local server mode.',
      connectionMode,
    });
    return;
  }

  const exportMode = message.exportMode === 'no-filter' ? 'no-filter' : 'visible-only';
  const includeAssets = message.includeAssets === true;
  const selectedNodes = getExportableSelection();
  const nodes = exportMode === 'visible-only'
    ? selectedNodes.filter(isEffectivelyVisible)
    : selectedNodes;
  if (nodes.length === 0) {
    const error = exportMode === 'visible-only'
      ? 'Select one or more visible frames, components, component sets, or instances first, or choose No filter.'
      : 'Select one or more frames, components, component sets, or instances first.';
    figma.notify(error);
    figma.ui.postMessage({ type: 'export-error', error, connectionMode });
    return;
  }

  const savedFiles: string[] = [];
  const savedAssets = new Set<string>();
  try {
    const exports = await Promise.all(nodes.map(async (node) => {
      const exportedJson = await (node as SceneNode & ExportMixin).exportAsync({ format: 'JSON_REST_V1' });
      const figmaJson = exportMode === 'visible-only'
        ? removeInvisibleNodes(exportedJson)
        : exportedJson;
      const includeHidden = exportMode === 'no-filter';
      const sourceIconClassification = classifyIconNode(node);
      annotateExportedNodes(figmaJson, node, includeHidden);
      const variables = await resolveBoundVariables(node, figmaJson);
      const darkMode = await isDarkMode(node);
      const imageAssets = includeAssets
        ? await collectImageAssets(node, exportMode === 'no-filter', figmaJson)
        : [];
      const iconAssets = includeAssets
        ? await collectIconSvgAssets(node, includeHidden)
        : [];
      const assets = [...imageAssets, ...iconAssets];
      return {
        filename: `${slug(node.name)}-${exportMode}${darkMode ? '-dark' : ''}.json`,
        assets,
        payload: {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          source: {
            pageName: figma.currentPage.name,
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            ...sourceIconClassification,
          },
          assets: assets.map(({ kind, imageHash, nodeId, nodeName, filename, mimeType }) => ({
            kind,
            ...(imageHash ? { imageHash } : {}),
            ...(nodeId ? { nodeId, nodeName } : {}),
            file: `../assets/${filename}`,
            mimeType,
          })),
          variables,
          figma: figmaJson,
        },
      };
    }));

    if (connectionMode === 'download') {
      const filenameCounts = new Map<string, number>();
      const assets = new Map<string, ExportedAsset>();
      for (const entry of exports) {
        const count = (filenameCounts.get(entry.filename) ?? 0) + 1;
        filenameCounts.set(entry.filename, count);
        const filename = count === 1
          ? entry.filename
          : `${entry.filename.slice(0, -'.json'.length)}-${count}.json`;
        figma.ui.postMessage({
          type: 'download-file',
          filename,
          content: JSON.stringify(entry.payload, null, 2),
        });
        entry.assets.forEach((asset) => assets.set(asset.filename, asset));
      }
      for (const asset of assets.values()) {
        figma.ui.postMessage({
          type: 'download-asset',
          filename: asset.filename,
          mimeType: asset.mimeType,
          base64: asset.base64,
        });
      }
      figma.ui.postMessage({ type: 'download-complete', count: exports.length, assetCount: assets.size, connectionMode });
      return;
    }

    const bridgeUrl = message.bridge!;
    const bridgeToken = message.token!;
    for (const entry of exports) {
      const response = await fetch(`${bridgeUrl}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': bridgeToken },
        body: JSON.stringify({ filename: entry.filename, payload: entry.payload, assets: entry.assets }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result: unknown = await response.json();
      if (!isRecord(result) || typeof result.saved !== 'string') {
        throw new Error('The local bridge did not return the saved filename.');
      }
      savedFiles.push(result.saved);
      if (Array.isArray(result.assets)) {
        result.assets.forEach((filename) => {
          if (typeof filename === 'string') savedAssets.add(filename);
        });
      }
    }
    figma.ui.postMessage({ type: 'export-complete', count: savedFiles.length, files: savedFiles, assets: [...savedAssets], includeAssets, connectionMode });
  } catch (error) {
    figma.ui.postMessage({ type: 'export-error', error: String(error), files: savedFiles, assets: [...savedAssets], includeAssets, connectionMode });
  }
};

function removeInvisibleNodes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((child) => isInvisible(child) ? [] : [removeInvisibleNodes(child)]);
  }
  if (!isRecord(value)) return value;
  if (isInvisible(value)) return null;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
    isInvisible(child) ? [] : [[key, removeInvisibleNodes(child)]],
  ));
}

function isInvisible(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.visible === false;
}

function isEffectivelyVisible(node: SceneNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if ('visible' in current && current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

async function isDarkMode(node: SceneNode): Promise<boolean> {
  if (hasDarkLabel(node.name) || hasDarkVariant(node)) return true;

  const activeModeNames = await Promise.all(
    Object.entries(node.resolvedVariableModes).map(async ([collectionId, modeId]) => {
      try {
        const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
        return collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? '';
      } catch {
        return '';
      }
    }),
  );
  return activeModeNames.some(hasDarkLabel);
}

function hasDarkVariant(node: SceneNode): boolean {
  if (node.type === 'INSTANCE') {
    return Object.entries(node.componentProperties).some(([name, property]) =>
      (property.type === 'VARIANT' && hasDarkLabel(String(property.value))) ||
      (hasDarkLabel(name) && property.value === true),
    );
  }
  if (node.type === 'COMPONENT') {
    return Object.values(node.variantProperties ?? {}).some(hasDarkLabel);
  }
  return false;
}

function hasDarkLabel(value: string): boolean {
  return /\bdark\b/i.test(value);
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figma-node';
}

type IconClassification = {
  isIcon: boolean;
  iconClassification: 'name-match' | 'excluded-keyboard' | 'not-detected';
};

function classifyIconNode(node: SceneNode, insideKeyboard = false): IconClassification {
  if (insideKeyboard || isKeyboardNodeName(node.name)) {
    return { isIcon: false, iconClassification: 'excluded-keyboard' };
  }
  const normalizedName = node.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (/(^|[\s/_-])(?:icon|glyph|symbol|icn|ic)(?=$|[\s/_-])/.test(normalizedName)) {
    return { isIcon: true, iconClassification: 'name-match' };
  }
  return { isIcon: false, iconClassification: 'not-detected' };
}

function isKeyboardNodeName(name: string): boolean {
  const normalizedName = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return /(^|[\s/_-])keyboard(?=$|[\s/_-])/.test(normalizedName);
}

function annotateExportedNodes(figmaJson: unknown, root: SceneNode, includeHidden: boolean): void {
  const classifications = new Map<string, IconClassification>();
  const collect = (node: SceneNode, ancestorsVisible: boolean, insideKeyboard: boolean): void => {
    const visible = ancestorsVisible && node.visible;
    if (!includeHidden && !visible) return;
    const keyboardSubtree = insideKeyboard || isKeyboardNodeName(node.name);
    classifications.set(node.id, classifyIconNode(node, keyboardSubtree));
    if ('children' in node) node.children.forEach((child) => collect(child, visible, keyboardSubtree));
  };
  collect(root, true, false);

  const annotate = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(annotate);
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.id === 'string') {
      const classification = classifications.get(value.id);
      if (classification) Object.assign(value, classification);
    }
    Object.values(value).forEach(annotate);
  };
  annotate(figmaJson);
}

type ExportedAsset = {
  kind: 'image' | 'icon';
  filename: string;
  mimeType: string;
  base64: string;
  overwrite?: boolean;
  imageHash?: string;
  nodeId?: string;
  nodeName?: string;
};

async function collectImageAssets(root: SceneNode, includeHidden: boolean, figmaJson: unknown): Promise<ExportedAsset[]> {
  const hashes = new Set<string>();
  const visit = (node: SceneNode, ancestorsVisible: boolean): void => {
    const visible = ancestorsVisible && node.visible;
    if (!includeHidden && !visible) return;
    const inspectPaints = (paints: unknown): void => {
      if (!Array.isArray(paints)) return;
      for (const paint of paints) {
        if (isRecord(paint) && paint.type === 'IMAGE' && typeof paint.imageHash === 'string') {
          hashes.add(paint.imageHash);
        }
      }
    };
    if ('fills' in node) inspectPaints(node.fills);
    if ('strokes' in node) inspectPaints(node.strokes);
    if ('children' in node) node.children.forEach((child) => visit(child, visible));
  };
  visit(root, true);
  const visitJson = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitJson);
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.imageRef === 'string') hashes.add(value.imageRef);
    if (value.type === 'IMAGE' && typeof value.imageHash === 'string') hashes.add(value.imageHash);
    Object.values(value).forEach(visitJson);
  };
  visitJson(figmaJson);

  return Promise.all([...hashes].map(async (imageHash) => {
    const image = figma.getImageByHash(imageHash);
    if (!image) throw new Error(`Could not load image asset ${imageHash}.`);
    const bytes = await image.getBytesAsync();
    const format = detectImageFormat(bytes);
    const hash = image.hash.replace(/[^a-z0-9_-]/gi, '') || imageHash.replace(/[^a-z0-9_-]/gi, '');
    if (!hash) throw new Error(`Could not name image asset ${imageHash}.`);
    return {
      kind: 'image',
      imageHash,
      filename: `image-${hash}.${format.extension}`,
      mimeType: format.mimeType,
      base64: encodeBase64(bytes),
    };
  }));
}

async function collectIconSvgAssets(root: SceneNode, includeHidden: boolean): Promise<ExportedAsset[]> {
  const iconNodes: SceneNode[] = [];
  const visit = (node: SceneNode, ancestorsVisible: boolean, insideKeyboard: boolean): void => {
    const visible = ancestorsVisible && node.visible;
    if (!includeHidden && !visible) return;
    const keyboardSubtree = insideKeyboard || isKeyboardNodeName(node.name);
    if (keyboardSubtree) return;
    if (classifyIconNode(node).isIcon) {
      iconNodes.push(node);
      return;
    }
    if ('children' in node) node.children.forEach((child) => visit(child, visible, keyboardSubtree));
  };
  visit(root, true, false);

  return Promise.all(iconNodes.map(async (node) => {
    const svg = await (node as SceneNode & ExportMixin).exportAsync({ format: 'SVG_STRING' });
    return {
      kind: 'icon',
      nodeId: node.id,
      nodeName: node.name,
      filename: `icon-${slug(node.name)}-${slug(node.id)}.svg`,
      mimeType: 'image/svg+xml',
      base64: encodeUtf8Base64(svg),
      overwrite: true,
    };
  }));
}

function encodeUtf8Base64(value: string): string {
  const encoded = encodeURIComponent(value);
  const bytes = new Uint8Array(encoded.length);
  let length = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes[length] = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
      length += 1;
      index += 2;
    } else {
      bytes[length] = encoded.charCodeAt(index);
      length += 1;
    }
  }
  return encodeBase64(bytes.subarray(0, length));
}

function detectImageFormat(bytes: Uint8Array): { extension: string; mimeType: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { extension: 'gif', mimeType: 'image/gif' };
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  if (String.fromCharCode(...bytes.subarray(4, 12)).includes('ftypavif')) {
    return { extension: 'avif', mimeType: 'image/avif' };
  }
  const prefix = String.fromCharCode(...bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) {
    return { extension: 'svg', mimeType: 'image/svg+xml' };
  }
  return { extension: 'bin', mimeType: 'application/octet-stream' };
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  const chunkSize = 0x3000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length);
    let encoded = '';
    for (let index = start; index < end; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < end;
      const hasThird = index + 2 < end;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      encoded += alphabet[first >> 2];
      encoded += alphabet[((first & 3) << 4) | (second >> 4)];
      encoded += hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
      encoded += hasThird ? alphabet[third & 63] : '=';
    }
    chunks.push(encoded);
  }
  return chunks.join('');
}

type VariableBinding = {
  id: string;
  bindingPath: string;
  consumer: SceneNode;
};

type ExportedVariable = {
  id: string;
  name: string | null;
  type: VariableResolvedDataType | null;
  collection: string | null;
  mode: string | null;
  consumerNodeId: string;
  consumerNodeName: string;
  bindingPath: string;
  value: VariableValue | null;
  hex?: string;
  error?: string;
};

async function resolveBoundVariables(root: SceneNode, figmaJson: unknown): Promise<ExportedVariable[]> {
  const sceneNodes = new Map<string, SceneNode>();
  const visitSceneNode = (node: SceneNode): void => {
    sceneNodes.set(node.id, node);
    if ('children' in node) node.children.forEach(visitSceneNode);
  };
  visitSceneNode(root);

  const bindings: VariableBinding[] = [];
  const visitExportNode = (value: unknown): void => {
    if (!isRecord(value)) return;
    const consumer = typeof value.id === 'string' ? sceneNodes.get(value.id) : undefined;
    if (consumer) {
      collectBindings(value, '$', consumer, bindings);
      if (Array.isArray(value.children)) value.children.forEach(visitExportNode);
      return;
    }
    Object.values(value).forEach((child) => {
      if (Array.isArray(child)) child.forEach(visitExportNode);
      else visitExportNode(child);
    });
  };
  visitExportNode(figmaJson);

  const variableCache = new Map<string, Promise<Variable | null>>();
  const getVariable = (id: string): Promise<Variable | null> => {
    let variable = variableCache.get(id);
    if (!variable) {
      variable = figma.variables.getVariableByIdAsync(id);
      variableCache.set(id, variable);
    }
    return variable;
  };

  return Promise.all(bindings.map(async ({ id, bindingPath, consumer }) => {
    const entry: ExportedVariable = {
      id,
      name: null,
      type: null,
      collection: null,
      mode: null,
      consumerNodeId: consumer.id,
      consumerNodeName: consumer.name,
      bindingPath,
      value: null,
    };
    try {
      const variable = await getVariable(id);
      if (!variable) {
        entry.error = 'Variable could not be resolved in this file.';
        return entry;
      }

      entry.name = variable.name;
      entry.type = variable.resolvedType;
      const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      entry.collection = collection?.name ?? null;
      const modeId = consumer.resolvedVariableModes[variable.variableCollectionId];
      entry.mode = collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? null;

      const resolved = variable.resolveForConsumer(consumer);
      entry.value = resolved.value;
      if (resolved.resolvedType === 'COLOR') entry.hex = colorToHex(resolved.value);
    } catch (error) {
      entry.error = String(error);
    }
    return entry;
  }));
}

function collectBindings(value: Record<string, unknown>, path: string, consumer: SceneNode, bindings: VariableBinding[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (key === 'children') continue;
    const childPath = `${path}.${key}`;
    if (key === 'boundVariables') {
      collectVariableIds(child, childPath, consumer, bindings);
    } else if (isRecord(child)) {
      collectBindings(child, childPath, consumer, bindings);
    } else if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isRecord(item)) collectBindings(item, `${childPath}[${index}]`, consumer, bindings);
      });
    }
  }
}

function collectVariableIds(value: unknown, path: string, consumer: SceneNode, bindings: VariableBinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectVariableIds(item, `${path}[${index}]`, consumer, bindings));
  } else if (isRecord(value)) {
    if (typeof value.id === 'string') {
      bindings.push({ id: value.id, bindingPath: path, consumer });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      collectVariableIds(child, `${path}.${key}`, consumer, bindings);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function colorToHex(value: VariableValue): string | undefined {
  if (!isRecord(value) || !['r', 'g', 'b'].every((channel) => typeof value[channel] === 'number')) return undefined;
  const channels = ['r', 'g', 'b'].map((channel) => Math.round(Math.max(0, Math.min(1, value[channel] as number)) * 255));
  if (typeof value.a === 'number' && value.a < 1) {
    channels.push(Math.round(Math.max(0, Math.min(1, value.a)) * 255));
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
