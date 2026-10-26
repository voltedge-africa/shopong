// When the phone comes back online, it tries once at once (review P9). The netinfo event can repeat while the phone
// stays online, so only a change from offline to online counts: the backoff still applies after that one try.

/** Whether this netinfo reading is a change from offline to online. */
export function cameBackOnline(wasOffline: boolean, isOffline: boolean): boolean {
  return wasOffline && !isOffline;
}
