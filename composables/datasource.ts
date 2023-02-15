import * as _nostrTools from "nostr-tools";

import profile from "@/composables/model/profile";
import note from "@/composables/model/note";
import { processExpression } from "@vue/compiler-core";

const {
    SimplePool,
    Kind,
    nip05,
    nip19,
} = _nostrTools;

const pool = new SimplePool();

const DEFAULT_RELAYS = ["wss://relay.damus.io"];

const profileCache: any = {};
const noteOfProfileCache: any = {};
const noteCache: any = {};
const eventCache: any = {};
const nip05Cache: any = {};
const floodContentMap: any = {};

interface Cached {
    data: any,
}

let getCacheArray = (cache: any, key: string, update = (key: string, cached: Cached) => { }): Cached => {
    return getCacheData(cache, key, () => [], update);
}

let getCacheData = (cache: any, key: string, create: Function, update = (key: string, cached: Cached) => { }): Cached => {
    let cached = cache[key];
    if (!cached) {
        cached = reactive({ data: create() });
        cache[key] = cached;
        if (process.client) {
            update && update(key, cached);
        }
    }
    return cached;
}

let getProfileCached = (pubkey: string, update = () => { }): Cached => {
    return getCacheData(profileCache, pubkey, () => (
        {
            pubkey: pubkey, nip19: nip19.npubEncode(pubkey)
        }), update);
}

let subEventHandler = (event: any) => {
    try {
        if (event.kind === Kind.Metadata) {
            let cached = profileCache[event.pubkey];
            Object.assign(cached.data, profile.fromEvent(event));
        } else if (event.kind === Kind.Text) {
            let cachedGlobal = getCacheArray(noteCache, '');
            let cached = getCacheArray(noteOfProfileCache, event.pubkey);
            let data = note.fromEvent(event);
            if (!isFlood(data)) {
                cachedGlobal.data.push(data);
            }
            cached.data.push(data);
        }
    } catch (e) {
        console.log('error when handle event', e);
    }
}

const checkNip05 = (pubkey: string, identity: string): Cached => {
    return getCacheData(nip05Cache, identity, () => ({ identity: identity, status: 'loading' }), (key, cached) => {
        cached.data.status = 'loading';
        nip05.queryProfile(identity).then((nip05Result: any) => {
            if (pubkey === nip05Result.pubkey) {
                cached.data.status = 'verified';
            } else {
                cached.data.status = 'fake';
            }
        }).catch(() => {
            cached.data.status = 'fail';
        });
    });
}

const getProfile = (pubkey: string): Cached => {
    let cached = profileCache[pubkey];
    if (!cached) {
        cached = reactive({ data: { pubkey: pubkey, nip19: nip19.npubEncode(pubkey) } });
        profileCache[pubkey] = cached;

        if (process.client) {
            let relays = [...DEFAULT_RELAYS];
            let sub = pool.sub(relays, [{
                kinds: [Kind.Metadata],
                authors: [pubkey],
            }]);
            sub.on("event", subEventHandler);
            sub.on("eose", () => {
                // sub.unsub(); 
            });
        }
    }
    return cached;
}

const getNotes = (): Cached => {
    return getCacheArray(noteCache, '', (key, cached) => {
        let relays = [...DEFAULT_RELAYS];
        let sub = pool.sub(relays, [{
            kinds: [Kind.Text],
        }]);
        sub.on("event", subEventHandler);
        sub.on("eose", () => {
            // sub.unsub();
        });
    });
}

const getNotesOfPubkey = (pubkey: string): Cached => {
    let cached = noteOfProfileCache[pubkey];
    if (!cached) {
        cached = reactive({ data: ref([]) });
        noteOfProfileCache[pubkey] = cached;

        if (process.client) {
            let relays = [...DEFAULT_RELAYS];
            let sub = pool.sub(relays, [{
                kinds: [Kind.Text],
                authors: [pubkey],
            }]);

            sub.on("event", subEventHandler);
            sub.on("eose", () => {
                // sub.unsub();
            });

        }
    }
    return cached;
}

const isEventFlood = (event: any): boolean => {
    let cached = getCacheData(floodContentMap, event.pubkey, () => ({ latest: [] }));
    if (cached.data.latest.some((e: any) => e.content == event.content && event.id != e.id) || (cached.data.latest.length > 0 && Date.now() - cached.data.latest[cached.data.latest.length - 1].createdAt < 60 * 1000)) {
        // TODO fix check prev
        return true;
    } else {
        if (cached.data.latest.length > 10) {
            cached.data.latest.shift();
        }
        cached.data.latest.push(event);
        return false;
    }
}

const isFlood = (note: any): boolean => {
    return isEventFlood(note.event);
}

const datasource = {
    checkNip05, getProfile, getNotes, getNotesOfPubkey, isFlood
}

export default datasource;
