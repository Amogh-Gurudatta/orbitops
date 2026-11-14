// One-time display of a newly issued device key, with copy-to-clipboard. The plaintext key exists only
// in this component's props; once dismissed it cannot be recovered.
import { useState } from 'react';
import { Button } from '../../ui/index.ts';

export function KeyReveal({
  deviceName,
  secret,
  onDismiss,
}: {
  deviceName: string;
  secret: string;
  onDismiss(): void;
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div role="alert" className="border-b border-caution p-1">
      <p className="mnemonic text-xs text-caution">NEW KEY FOR {deviceName}</p>
      <p className="py-0.5 text-xs text-text">Store this key now — it will not be shown again.</p>
      <div className="flex items-center gap-1">
        <code
          className="num min-w-0 flex-1 select-all overflow-x-auto border border-rule bg-bg px-1 text-xs leading-[30px] whitespace-nowrap text-text"
          aria-label="Device API key"
        >
          {secret}
        </code>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copied === 'ok' ? 'COPIED' : copied === 'failed' ? 'COPY FAILED' : 'COPY'}
        </Button>
        <Button size="sm" onClick={onDismiss}>
          DONE
        </Button>
      </div>
    </div>
  );
}
