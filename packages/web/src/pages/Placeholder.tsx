// Stand-in view for pages whose feature work is still pending. Replaced page by page.
import { Panel } from '../ui/index.ts';

export function Placeholder({ code, title, note }: { code: string; title: string; note?: string }) {
  return (
    <Panel title={code} subtitle={title}>
      <div className="flex h-full min-h-24 flex-col items-start justify-center gap-1 p-1">
        <span className="mnemonic text-sm text-text-2">{title}</span>
        <p className="mnemonic text-xs text-text-dim">PENDING{note ? ` // ${note}` : ''}</p>
      </div>
    </Panel>
  );
}
