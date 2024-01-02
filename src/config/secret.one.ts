import firebase from 'firebase/app';
import { UserCredential, getAuth, Auth, signInWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { getDatabase, Database, ref, set, onValue, DataSnapshot, DatabaseReference } from 'firebase/database';
import { HttpsCallableResult, getFunctions, httpsCallable } from 'firebase/functions';
import crypto from 'crypto';


// CONSTANTS
const oneMinute = 60000;
const firebaseConfig = {
    apiKey: "AIzaSyBvoVNxn8jmbj_3AzxSXcuFI5f1N72AHYE",
    authDomain: "one-key-pass.firebaseapp.com",
    databaseURL: "https://one-key-pass-default-rtdb.firebaseio.com",
    projectId: "one-key-pass",
    // storageBucket: "one-key-pass.appspot.com",
    // messagingSenderId: "194302411212",
    appId: "1:194302411212:web:9ce7442ce92624756e1d69"
};

// State resources
export const pending = new Set<string>();
export const callbacks = new Map<string, string>();

const resolve = <T>(value: T): T => value;
const state = {
    app: null as firebase.FirebaseApp | null,
    auth: null as Auth | null,
    db: null as Database | null,
    puppet: null as {
        user: string,
        pass: string,
    } | null,
    client: null as string | null,
    api: null as string | null,
    callback: undefined as boolean | undefined,
}

// INTERFACES
export interface TagsResult {
    [key: string]: string[];
}
interface ListenerSnapshot {
    iv: string;
    payload: string;
}
interface CustomAuthResponse {
    customToken: string;
    payload: string;
}
interface SecretOneCredentials {
    client: string, api: string
}
interface SecretOneAuth {
    user: string, pass: string
}

// PUBLIC METHODS
export const CallbackInvoke: any = (id: string, key: string) => {
    callbacks.set(id, key);
}

export function init(creds: SecretOneCredentials, callback?: boolean): void {
    //health check client credentials
    if (!creds.client || !creds.api)
        throw new Error('Secret One: Invalid Client credentials provided.');
    if (typeof creds.client !== "string" || typeof creds.api !== "string")
        throw new Error('Secret One: Invalid Client credentials provided.');

    state.app = firebase.initializeApp(firebaseConfig, creds.client);
    state.auth = getAuth(state.app);
    state.auth.authStateReady().then(resolve);
    state.db = getDatabase(state.app);
    state.client = creds.client;
    state.api = creds.api;
    state.callback = callback;
}

export function login(creds: SecretOneAuth) {
    // health check auth credentials
    if (!creds.user || !creds.pass)
        throw new Error('Secret One: Invalid Auth credentials provided.');
    if (typeof creds.user !== "string" || typeof creds.pass !== "string")
        throw new Error('Secret One: Invalid Auth credentials provided.');

    const { user, pass } = creds;
    state.puppet = {
        user,
        pass
    }

    console.log("Auth 1");
    if (!state.client) throw new Error('Secret One: not initialized or no reference provided.');
    else LoginSubUser(user, pass).then(resolve);
    console.log("Auth 4");

    state.auth?.currentUser?.getIdTokenResult()
        .then((result) => {
            const tokens = result;
            console.log("Tokens", tokens);
            console.log("Auth 6a");
            if (!tokens.claims.puppet) {
                throw new Error('Secret One: not authenticated as a subordinate user.');
            }
        })
        .catch((error) => {
            console.log("Auth 6b");
            console.error('Error getting token result:', error);
            throw error; // Rethrow the error to pass it along
        });
    console.log("Auth 7");

}

export async function RequestTags(tags: string[], callback?: (tags: TagsResult) => any): Promise<TagsResult> {
    // Health Checks
    if (!state.client || !state.db) throw new Error('Secret One: not initialized or no reference provided.');
    if (!state.auth?.currentUser?.uid) throw new Error('Secret One: not authenticated');


    // check if user is elevated
    let validated = false;
    const tokens = await state.auth?.currentUser?.getIdTokenResult();
    if (!tokens) throw new Error('Secret One:Auth not initialized');
    else if (tokens.claims.session) validated = true;
    // check if session expired? l/

    // if not validated, request validation
    if (!validated)
        await ValidateSubUser(state.auth.currentUser.uid, "");

    const seed = crypto.randomBytes(32);
    const eventID = crypto.createHash('sha256').update(seed.toString('hex')).digest('hex');
    pending.add(eventID);

    // Invoke and Handle response
    const payload = { tags, api: state.api, id: eventID }
    const result = await HandleResponse(eventID, payload);

    // Decode payload to tags
    const tagsResult: TagsResult = {};
    // TODO: payload needs to be decoded
    for (const key in result) {
        const value = result[key];
        if (value) {
            tagsResult[key] = value;
        }
    }

    // cleanup and finalize
    pending.delete(eventID);
    callbacks.delete(eventID);
    

    if (callback) callback(tagsResult);
    return tagsResult;
}

// PRIVATE METHODS
async function HandleResponse(id: string, payload: object): Promise<TagsResult> {

    const requestPath = ['request', state!.auth!.currentUser!.uid, id].join('/');
    const responsePath = requestPath.replace('request', 'response');
    const db = state.db as Database;

    const listener: DatabaseReference = ref(db as Database, responsePath);
    await set(ref(db, requestPath), payload);

    const TagListener = new Promise(async (resolve, reject) => {
        // Create a promise for the onValue listener
        const listenerPromise = new Promise((innerResolve, _innerReject) => {
            onValue(listener, (snapshot: DataSnapshot) => {
                if (!snapshot.exists()) return;

                const data = snapshot.val() as ListenerSnapshot;
                // Close listener and resolve
                innerResolve(JSON.parse(data.payload));
            });
        });

        // Set a timeout for 60 seconds
        const timeoutPromise = new Promise((_innerResolve, innerReject) => {
            setTimeout(() => {
                innerReject(new Error('Timeout: The promise took more than 60 seconds.'));
            }, oneMinute); // 60 seconds in milliseconds
        });

        // Use Promise.race to wait for either the listenerPromise or the timeoutPromise
        Promise.race([listenerPromise, timeoutPromise])
            .then((result) => {
                // If the listenerPromise resolves first, resolve the main promise with its result
                resolve(result);
            })
            .catch((error) => {
                // If the timeoutPromise rejects first, reject the main promise with the timeout error
                reject(error);
            });
    });


    // Handle endpoint callback
    const Endpoint = new Promise(async (resolve, reject) => {
        // if callback is enabled, wait for callback to be invoked else resolve
        let tries = 0;
        if (state.callback) {
            const interval = setInterval(() => {
                tries++;
                if (tries > 600) reject("Timeout");
                else if (callbacks.has(id)) {
                    callbacks.delete(id);
                    clearInterval(interval);
                    resolve(true);
                }
            }, 100);
        }
        else resolve(true);
    });

    // Resolve handshake scenario
    const results = await Promise.allSettled([TagListener, Endpoint])

    if (results[0].status === "fulfilled") { }
    else if (results[0].status === "rejected") { }

    if (results[1].status === "fulfilled") { }
    else if (results[1].status === "rejected") { }

    return {};

}

async function LoginSubUser(user: string, password: string): Promise<UserCredential> {
    const email = [user, state.client || "unknown", '@secret-one.com'].join('.');
    if (!state.auth) throw new Error('Secret One:Auth not initialized');
    console.log("Auth 2");
    try {
        const userCredential = await signInWithEmailAndPassword(state.auth, email, password);
        console.log('User logged in:', userCredential.user?.uid);
        console.log("Auth 3");
        return userCredential;
    } catch (error: any) {
        console.error('Error authenticating Secret One user:', error);
        throw error;
    }
}

async function ValidateSubUser(uid: string, payload: string): Promise<any> {
    if (!state.app) throw new Error('Secret One:App not initialized');
    // ensure user is authenticated and tokens are not expired
    try {
        const authSubUserFunction = httpsCallable(getFunctions(state.app), 'authSubUser');
        const result = await authSubUserFunction({ uid, payload }) as HttpsCallableResult<CustomAuthResponse>;
        const token = result.data.customToken;
        await customAuthToken(token)
        return result.data;
    } catch (error: any) {
        console.error('Error calling Cloud Function:', error.message);
        throw error;
    }
}

async function customAuthToken(customToken: string): Promise<void> {
    if (!state.auth) throw new Error('Secret One: Invalid custom token provided.');
    try {
        await signInWithCustomToken(state.auth, customToken);
        console.log('User authenticated with custom token');
    } catch (error: any) {
        console.error('Error authenticating with custom token:', error.message);
        throw error;
    }
    return;
}