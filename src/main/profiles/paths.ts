import path from 'path';

export interface ProfilePaths {
  userDataRoot: string;
  profilesDir: string;
  backupsDir: string;
  activeProfileFile: string;
}

export function getProfilePaths(userDataRoot: string): ProfilePaths {
  return {
    userDataRoot,
    profilesDir: path.join(userDataRoot, 'profiles'),
    backupsDir: path.join(userDataRoot, 'backups'),
    activeProfileFile: path.join(userDataRoot, 'active-profile.json'),
  };
}

export function profileFilePath(paths: ProfilePaths, profileId: string): string {
  return path.join(paths.profilesDir, `profile-${profileId}.json`);
}

export function profileRuntimeStatePath(paths: ProfilePaths, profileId: string): string {
  return path.join(paths.profilesDir, `profile-${profileId}-runtime.json`);
}
