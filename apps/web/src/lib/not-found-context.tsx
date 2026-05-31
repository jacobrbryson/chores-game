"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";

type NotFoundContextValue = {
  isNotFound: boolean;
  setNotFound: () => void;
};

const NotFoundContext = createContext<NotFoundContextValue>({
  isNotFound: false,
  setNotFound: () => {},
});

export function NotFoundProvider({ children }: { children: React.ReactNode }) {
  const [isNotFound, setIsNotFound] = useState(false);
  const setNotFound = useCallback(() => setIsNotFound(true), []);
  return (
    <NotFoundContext value={{ isNotFound, setNotFound }}>
      {children}
    </NotFoundContext>
  );
}

export function useNotFound() {
  return useContext(NotFoundContext);
}

export function SetNotFound() {
  const { setNotFound } = useNotFound();
  useLayoutEffect(() => {
    setNotFound();
  }, [setNotFound]);
  return null;
}
