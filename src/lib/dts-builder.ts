import * as path from 'path';
import * as fs from 'fs';

import { copyFile } from './copy-file';
import { findFiles } from './find-files';
import * as patterns from './regexp-patterns';

import ErrnoException = NodeJS.ErrnoException;

export interface Bundle {
  /**
   * Bundle name. Used for d.ts filename and the wrapping namespace.
   */
  name: string;
  sourceDir: string;
  destDir: string;
  externals?: Array<string>
}

export let DTSBuilderVerbose: boolean = true;

/**
 * @param {Bundle[]} bundles
 */
export function generateBundles(bundles: Array<Bundle>): void {
  if (!Array.isArray(bundles)) {
    throw new TypeError(`Invalid bundles argument, must be an array. Got ${typeof bundles}.`);
  }

  const len = bundles.length;
  log('Generating definition for %d bundle(s)...', len);
  if (!len) {
    log('Nothing to do... Bye.');
    return;
  }

  bundles.forEach(bundle => {
    log('> Generating bundle %s', bundle.name);

    log(' + Gathering definitions from %s/**/*.d.ts', bundle.sourceDir);
    const dtsFiles = findFiles(bundle.sourceDir);
    if (!dtsFiles.length) {
      log('No files were found in bundle %s.', bundle.name);
      return;
    }
    log('   + Found %d definition files.', dtsFiles.length);

    log(' + Concatenating definitions to a single file');
    const binBuffers: Array<Buffer> = dtsFiles.map(file => fs.readFileSync(file));
    let txtBuffer: string = binBuffers.map(buffer => buffer.toString()).join("\n");
    log('   + Done, total size: %d characters', txtBuffer.length);

    log(' + Optimizing imports...');
    txtBuffer = optimizeImports(txtBuffer);
    log(' + Wrapping with module...');
    txtBuffer = moduleWrap(txtBuffer, bundle);

    if (bundle.externals) {
      log(' + Adding external definition files...');
      txtBuffer = addExternalRefs(bundle) + '\n' + txtBuffer;
    }
    const destFile: string = pathAppend(bundle.destDir, `${bundle.name}.d.ts`);
    log(' +-> Saving %s...', destFile);
    fs.writeFile(destFile, txtBuffer, (err: ErrnoException) => {
      if (err) {
        throw new Error(err.message);
      }
      log('! "%s" bundle is ready', bundle.name);
    });

  });
}

/**
 * @param {string} src
 * @param {string} dst
 * @returns {string}
 */
export function pathAppend(src: string, dst: string): string {
  src = src.trim().replace(/\/+$/, '');
  dst = dst.trim().replace(/^\/+/, '');
  return [src, dst].join('/');
}

/**
 * @param {string} txtBuffer
 * @returns {string}
 */
function optimizeImports(txtBuffer: string): string {
  // remove imports
  var result = txtBuffer.replace(patterns.externalModule, '');

  // get unique internal imports
  var internalImports = getUnique(
    result
      .match(patterns.internalModule)
      .map(imp => imp.toString().trim())
  );

  // remove internal imports
  result = result.replace(patterns.internalModule, '');

  var remaining = result.match(/\bimport\b/);
  if (remaining && remaining.length) {
    console.error('Could not deal with the following:', JSON.stringify(remaining, null, 2));
  }

  // add internals
  result = sortInternals(internalImports).join('\n') + '\n' + result;
  result = removeReferences(result);
  result = removeDefaults(result);

  // remove export * from ...
  result = result.replace(patterns.externalReExports, '');

  return result;
}

/**
 * Returns unique array elements
 * @param {Array} arr
 * @returns {Array}
 */
function getUnique<T>(arr: Array<T>): Array<T> {
  let res: Array<T> = [];
  arr.forEach(item => {
    if (res.indexOf(item) === -1) res.push(item);
  });
  return res;
}

/**
 * @param {Array} arr
 * @returns {Array}
 */
function sortInternals(arr: Array<string>): Array<string> {
  return arr
    .map(line => line.match(patterns.internalModuleParts))
    .sort(sortMatches)
    .map(obj => `import ${obj[1]} = ${obj[2]};`);
}

/**
 * @param {Array} a
 * @param {Array} b
 * @returns {number}
 * @private
 */
function sortMatches(a: Array<string>, b: Array<string>): number {
  const impA = a[2].toLowerCase();
  const impB = b[2].toLowerCase();
  if (impA < impB) return -1;
  if (impA > impB) return +1;
  return 0;
}

/**
 * @param {string} text
 * @returns {string}
 */
function removeReferences(text: string): string {
  return text.replace(patterns.reference, '');
}

/**
 * @param {Bundle} bundle
 * @returns {string}
 */
function addExternalRefs(bundle: Bundle) {
  const res = bundle.externals.map(ref => {
    const fileName = path.basename(ref);
    copyFile(ref, pathAppend(bundle.destDir, fileName), (err, res) => {
      if (err) {
        throw new Error(err.message);
      }
      // TODO: localize references of the copied file, or update path
      log('+++ Copied external reference: %s', path.basename(res));
    });
    log(' * Referencing external: %s', fileName);
    return `/// <reference path="${fileName}" />`;
  });
  return res.join('\n');
}


/**
 * @param {string} text
 * @returns {string}
 */
function removeDefaults(text: string): string {
  return text.replace(patterns.defaultExport, '');
}

/**
 * @param {string} text
 * @param {Bundle} bundle
 * @returns {string}
 */
function moduleWrap(text: string, bundle: Bundle): string {
  log(' * Converting to module...');
  let lines = text
    .split('\n')
    .map(line => '  ' + line
      .replace(/\bexport\s+declare\s+/, 'export ')
      .replace(/\bdeclare\s+(class|function|const|var|let)\s+/, '$1 ')
    );
  lines.unshift('declare module ' + bundle.name + ' {');
  lines.push('}');
  return lines.join('\n');
}

/**
 * Logging helper
 */
function log(message: any, ...args: any[]) {
  if (!DTSBuilderVerbose) return;
  console.log(message, ...args);
}
