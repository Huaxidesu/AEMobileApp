// 全局服务器配置上下文
import React, { createContext, useContext, useEffect, useState } from 'react';
import { isConfigComplete, loadConfig, ServerConfig } from './api';

interface ConfigCtx {
  config: ServerConfig;
  ready: boolean;
  complete: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<ConfigCtx>(null as any);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>({ scheme: 'http', ip: '', port: '44444', uuid: '', mainnet: null });
  const [ready, setReady] = useState(false);

  const reload = async () => {
    setConfig(await loadConfig());
    setReady(true);
  };

  useEffect(() => {
    reload();
  }, []);

  return <Ctx.Provider value={{ config, ready, complete: isConfigComplete(config), reload }}>{children}</Ctx.Provider>;
}

export function useConfig(): ConfigCtx {
  return useContext(Ctx);
}
