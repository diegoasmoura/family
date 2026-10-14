import { useState, type ReactNode } from 'react';
import { Confirm } from './ui';

export function useConfirm() {
  const [ask, setAsk] = useState<{ text: string; danger: boolean; run: () => void } | null>(null);

  const confirm = (text: string, run: () => void, danger = true) => setAsk({ text, danger, run });

  const dialog: ReactNode = ask ? (
    <Confirm
      danger={ask.danger}
      text={ask.text}
      onConfirm={() => {
        const run = ask.run;
        setAsk(null);
        run();
      }}
      onClose={() => setAsk(null)}
    />
  ) : null;

  return { confirm, dialog };
}
