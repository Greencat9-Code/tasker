// Template outline text <-> tree. One node per line, 2-space indent = child.
//   "Game *"            -> pipeline-tracked node (gets a stage)
//   "Apply (0/250)"     -> counter node with target 250
import type { TemplateNode } from './model';

export function parseOutline(text: string): TemplateNode[] {
  const rootList: TemplateNode[] = [];
  const stack: { depth: number; list: TemplateNode[] }[] = [{ depth: -1, list: rootList }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)![0].replace(/\t/g, '  ').length;
    const depth = Math.floor(indent / 2);
    let title = raw.trim();
    const node: TemplateNode = { title };
    const counter = title.match(/\(\s*0?\s*\/\s*(\d+)\s*\)\s*$/);
    if (counter) { node.counter = Number(counter[1]); title = title.slice(0, counter.index).trim(); }
    if (/\*$/.test(title)) { node.pipeline = true; title = title.replace(/\s*\*$/, '').trim(); }
    node.title = title;
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].list.push(node);
    stack.push({ depth, list: (node.children = []) });
  }
  const strip = (nodes: TemplateNode[]) => { for (const n of nodes) { if (n.children && !n.children.length) delete n.children; else if (n.children) strip(n.children); } };
  strip(rootList);
  return rootList;
}

export function toOutline(nodes: TemplateNode[], depth = 0): string {
  let out = '';
  for (const n of nodes) {
    out += '  '.repeat(depth) + n.title + (n.pipeline ? ' *' : '') + (n.counter ? ` (0/${n.counter})` : '') + '\n';
    if (n.children?.length) out += toOutline(n.children, depth + 1);
  }
  return out;
}
