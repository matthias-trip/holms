export type {
  PropertyName,
  CommandFieldDef,
  EntityRegistration,
  EntityGroup,
  RegistrationResult,
  Adapter,
  AdapterFactory,
  DiscoverResult,
  PairResult,
  QueryResult,
} from "./types.js";

export type {
  ParentMessage,
  InitMessage,
  ObserveMessage,
  ExecuteMessage,
  PingMessage,
  ShutdownMessage,
  DiscoverMessage,
  PairMessage,
  QueryMessage,
  ChildMessage,
  ReadyMessage,
  ObserveResultMessage,
  ExecuteResultMessage,
  StateChangedMessage,
  PongMessage,
  ErrorMessage,
  LogMessage,
  DiscoverResultMessage,
  PairResultMessage,
  QueryResultMessage,
} from "./protocol.js";

export { PROTOCOL_VERSION } from "./protocol.js";

export { runAdapter } from "./harness.js";
