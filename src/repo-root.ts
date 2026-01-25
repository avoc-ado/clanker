export const getRepoRoot = (): string => {
  const envRoot = process.env.CLANKER_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return envRoot;
  }
  return process.cwd();
};
