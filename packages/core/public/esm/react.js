// Petal React shim
// Re-exports the host's React instance so cross-origin custom app chunks share
// the same dispatcher (required for hooks to work).
// window.__petal_react is set synchronously by <ReactGlobals /> in layout.tsx.
const R = globalThis.__petal_react
if (!R) throw new Error("[Petal] react shim: window.__petal_react is not set")

export default R
export const {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = R
