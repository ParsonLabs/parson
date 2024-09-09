import { useState, useEffect } from 'react';

export const useStore = <T, F>(
  store: (callback: (state: T) => unknown) => unknown,
  callback: (state: T) => F
) => {
  const [data, setData] = useState<F>();

  useEffect(() => {
    const result = store(callback) as F;
    setData(result);
  }, [store, callback]);

  return data;
};