import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize(): [number, number] {
  const { stdout } = useStdout();
  const [size, setSize] = useState<[number, number]>([stdout.columns ?? 80, stdout.rows ?? 24]);

  useEffect(() => {
    const onResize = (): void => {
      setSize([stdout.columns ?? 80, stdout.rows ?? 24]);
    };
    if (typeof stdout.on === 'function' && typeof stdout.off === 'function') {
      stdout.on('resize', onResize);
      return () => {
        stdout.off('resize', onResize);
      };
    }
    return undefined;
  }, [stdout]);

  return size;
}
