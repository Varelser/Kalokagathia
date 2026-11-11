import React from 'react';
import { StandaloneSynthWindow } from './StandaloneSynthWindow';

type AppModeGateProps = React.PropsWithChildren<{
  appModeParam: string;
  appModeValue: string;
}>;

export const AppModeGate: React.FC<AppModeGateProps> = ({ appModeParam, appModeValue, children }) => {
  const appMode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get(appModeParam)
    : null;
  if (appMode === appModeValue) {
    return <StandaloneSynthWindow />;
  }
  return <>{children}</>;
};
