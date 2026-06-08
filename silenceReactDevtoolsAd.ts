/** 必须在任何 react-dom 相关 import 之前被 index.tsx 引入，否则 react-dom 可能在首次渲染时仍打到未包装的 console.info */
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  if (args.some((a) => /react-devtools|reactjs\.org\/link\/react-devtools/i.test(String(a)))) return;
  originalInfo.apply(console, args as Parameters<typeof console.info>);
};
