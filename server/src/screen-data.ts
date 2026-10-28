export type ExportNode = Record<string, unknown> & { id: string; children?: ExportNode[] };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function documentRoot(data: unknown): ExportNode {
  const source = record(data) && record(data.figma) ? data.figma : data;
  const root = record(source) && record(source.document) ? source.document : source;
  if (!record(root) || typeof root.id !== 'string') throw new Error('This export does not contain a Figma document node.');
  return root as ExportNode;
}

export function* walkNodes(root: ExportNode): Generator<ExportNode> {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    yield node;
    if (Array.isArray(node.children)) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
  }
}

export function findNode(root: ExportNode, id: string): ExportNode {
  for (const node of walkNodes(root)) if (node.id === id) return node;
  throw new Error(`Node ${id} was not found in this export. It may have been filtered out.`);
}

export function summarizeTree(root: ExportNode, depth: number, maxNodes: number, compact = true) {
  let nodeCount = 0;
  let truncated = false;
  const visit = (node: ExportNode, remainingDepth: number): Record<string, unknown> => {
    nodeCount++;
    const { children = [], ...properties } = node;
    const result: Record<string, unknown> = compact
      ? Object.fromEntries(['id', 'name', 'type', 'visible', 'absoluteBoundingBox', 'size', 'relativeTransform', 'layoutMode', 'characters']
        .filter((key) => node[key] !== undefined).map((key) => [key, key === 'characters' && typeof node[key] === 'string' ? node[key].slice(0, 160) : node[key]]))
      : properties;
    result.childCount = children.length;
    if (children.length) {
      const shown: Record<string, unknown>[] = [];
      if (remainingDepth > 0) {
        for (const child of children) {
          if (nodeCount >= maxNodes) break;
          shown.push(visit(child, remainingDepth - 1));
        }
      }
      if (shown.length) result.children = shown;
      if (shown.length < children.length) { result.childrenTruncated = true; truncated = true; }
    }
    return result;
  };
  const tree = visit(root, depth);
  return { tree, nodeCount, truncated };
}
