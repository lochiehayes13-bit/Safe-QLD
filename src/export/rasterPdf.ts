/**
 * The phone half of rasterPdf.web.ts, which has nothing to do.
 *
 * The phone writes a vector PDF through expo-print (files.ts), so it never
 * lays a document out in a frame and photographs it. The browser does,
 * because a browser has no PDF writer. This file exists so the pair is a pair:
 * a `.web.ts` with nothing beside it is a module the native build has never
 * seen, and an import of it from shared code would only fail at run time.
 */
export {};
