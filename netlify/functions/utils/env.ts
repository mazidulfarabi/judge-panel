/** Dynamic lookup so esbuild/Netlify does not inline secret values into the function bundle. */
export function env(name: string): string | undefined {
  return process.env[name];
}
