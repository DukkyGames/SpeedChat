
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},n=(new Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="58af6b2a-dfd8-5e1d-9262-67e8ac32e125")}catch(e){}}();
import{l as r,n,q as o,s as a}from"/chunks/chunk-L4Q2TLGG.js";var L=(e,t,i,l)=>({id:s(),runtime:i,message:e,timestamp:l,fileName:t.fileName,lineNumber:t.lineNumber,srcLineNumber:t.srcLineNumber,severity:t.severity,prefix:t.prefix,highlight:t.highlight??!1,rawParams:t.rawParams});var s=()=>crypto.getRandomValues(new Uint32Array(1))[0].toString(36),d=()=>!0;var g=e=>o(e)?r`${e.loggableName}: ${e.loggableMessage}`:n.is(e)?e:"<redacted>",f=e=>e instanceof ErrorEvent?g(e.error):e instanceof PromiseRejectionEvent?g(e.reason):(a(e,r`event`),"<redacted>");export{L as a,s as b,d as c,f as d};

//# debugId=58af6b2a-dfd8-5e1d-9262-67e8ac32e125
