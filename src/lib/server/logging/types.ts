export interface RequestContext {
  request_id: string;
  method: string;
  path: string;
  user_id?: string;
  user_name?: string;
}

export interface LoggingConfig {
  level: string;
  pretty: boolean;
  jsonLogFile?: string;
}
