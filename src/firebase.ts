import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { TodoTask, MoodleNotification } from './types';

const app = initializeApp(firebaseConfig);
// CRITICAL: The app will break without this line
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Creates a unique key for the combined Moodle server and username to use as document ID
 */
export function getUserDocKey(server: 'a' | 'b', username: string): string {
  return `${server}_${username.trim().toLowerCase()}`;
}

export interface UserCachedData {
  moodleUsername: string;
  moodleServer: 'a' | 'b';
  tasks: TodoTask[];
  notifications?: MoodleNotification[];
  lastSyncedTime: number | null;
  updatedAt: string;
}

/**
 * Fetch a user's combined activities/tasks data Cache from Firestore
 */
export async function fetchUserCacheFromFirestore(server: 'a' | 'b', username: string): Promise<UserCachedData | null> {
  const docKey = getUserDocKey(server, username);
  const path = `user_data/${docKey}`;
  try {
    const docRef = doc(db, 'user_data', docKey);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as UserCachedData;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Save user's activities/tasks data Cache to Firestore
 */
export async function saveUserCacheToFirestore(
  server: 'a' | 'b',
  username: string,
  tasks: TodoTask[],
  lastSyncedTime: number | null,
  notifications?: MoodleNotification[]
): Promise<void> {
  const docKey = getUserDocKey(server, username);
  const path = `user_data/${docKey}`;
  
  // Filter only tasks that belong to this Moodle Account (including associated manual tasks)
  const normalizedUsername = username.trim().toLowerCase();
  const userTasks = tasks.filter(t => 
    t.moodleUsername?.trim().toLowerCase() === normalizedUsername && t.moodleServer === server
  );

  // Filter only notifications that belong to this Moodle Account
  const userNotifications = (notifications || []).filter(n =>
    n.moodleUsername?.trim().toLowerCase() === normalizedUsername && n.moodleServer === server
  );

  const payload: UserCachedData = {
    moodleUsername: username.trim(),
    moodleServer: server,
    tasks: userTasks,
    notifications: userNotifications,
    lastSyncedTime,
    updatedAt: new Date().toISOString()
  };

  try {
    const docRef = doc(db, 'user_data', docKey);
    await setDoc(docRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
