// The Places card on the Settings tab (story 7.3). The treasurer, or a co-treasurer, registers a collection point: its
// name, its suburb or town, its point and its address. The point and the address go to the OCN Node, which keeps them;
// the record gets the name and the suburb or town only. Every member gives their own suburb or town. The card shows the
// record's labels and areas, the demand by area (the treasurer only) and the Node's plain words, and nothing else.
import { useEffect, useState } from "react";
import { Alert, Button, Input, Text } from "panelui-native";
import { View } from "react-native";

import { useCommunity } from "../lib/CommunityProvider";
import { useIdentity } from "../lib/IdentityProvider";
import { areaDemandOf, placeChoicesOf, placesCardSectionsOf, type PlaceForm } from "../lib/places";
import type { RoutePlace } from "../lib/route";

const EMPTY_FORM: PlaceForm = { label: "", area: "", lat: "", lng: "", address: "" };

/** The collection points, the demand by area, and the member's own area. Empty until the community is made or joined. */
export function PlacesCard() {
  const { community, canAddPlaces, placesOf, registerPlace, memberAreasOf, setMemberArea } =
    useCommunity();
  const { did } = useIdentity();
  const [places, setPlaces] = useState<readonly RoutePlace[]>([]);
  const [areas, setAreas] = useState<readonly { did: string; area: string }[]>([]);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<PlaceForm>(EMPTY_FORM);
  const [yourArea, setYourArea] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (community === null) return;
    let current = true;
    void (async () => {
      const [list, members] = await Promise.all([placesOf(), memberAreasOf()]);
      if (!current) return;
      setPlaces(list);
      setAreas(members);
    })();
    return () => {
      current = false;
    };
  }, [community, placesOf, memberAreasOf, version]);

  if (community === null) return null;

  const choices = placeChoicesOf(places);
  const demand = areaDemandOf(areas);
  const sections = placesCardSectionsOf(canAddPlaces);
  const mine = areas.find((member) => member.did === did)?.area ?? "";

  const savePlace = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setSaved(undefined);
    const problem = await registerPlace(form);
    setBusy(false);
    if (problem === undefined) {
      setForm(EMPTY_FORM);
      setSaved("Saved. The name and the suburb or town are on the record.");
      setVersion((n) => n + 1);
    } else {
      setError(problem);
    }
  };

  const saveArea = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setSaved(undefined);
    const problem = await setMemberArea(yourArea);
    setBusy(false);
    if (problem === undefined) {
      setYourArea("");
      setSaved("Saved. Only your suburb or town is kept.");
      setVersion((n) => n + 1);
    } else {
      setError(problem);
    }
  };

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text accessibilityRole="header" size="xl" weight="bold">
        Places
      </Text>
      {error === undefined ? null : (
        <Alert variant="destructive">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {saved === undefined ? null : <Text muted>{saved}</Text>}

      {/* Every member sees the collection points, the areas and the demand (product owner, story 7.3). */}
      <View className="gap-3">
        <Text weight="bold">Collection points</Text>
        {places.length === 0 ? (
          <Text muted>No places are registered yet.</Text>
        ) : (
          places.map((place) => <Text key={place.id}>{`${place.label}, ${place.area}`}</Text>)
        )}
        <Text weight="bold">Members by area</Text>
        {demand.length === 0 ? (
          <Text muted>No member has given an area yet.</Text>
        ) : (
          demand.map((row) => <Text key={row.area}>{`${row.area}: ${row.members}`}</Text>)
        )}
      </View>

      {sections.registerForm ? (
        <View className="gap-3">
          <Text weight="bold">Add a collection point</Text>
          <Text muted>
            The point and the address stay on the OCN Node. The record gets the name and the suburb
            or town only.
          </Text>
          <Input
            label="Name of the place"
            value={form.label}
            onChangeText={(label) => setForm({ ...form, label })}
          />
          <Input
            label="Suburb or town"
            value={form.area}
            onChangeText={(area) => setForm({ ...form, area })}
          />
          <Input
            label="Latitude"
            value={form.lat}
            onChangeText={(lat) => setForm({ ...form, lat })}
            keyboardType="numbers-and-punctuation"
          />
          <Input
            label="Longitude"
            value={form.lng}
            onChangeText={(lng) => setForm({ ...form, lng })}
            keyboardType="numbers-and-punctuation"
          />
          <Input
            label="Address"
            value={form.address}
            onChangeText={(address) => setForm({ ...form, address })}
          />
          <Button fullWidth disabled={busy} onPress={() => void savePlace()}>
            Save place
          </Button>
        </View>
      ) : null}

      <View className="gap-3">
        <Text weight="bold">Your suburb or town</Text>
        <Text muted>Only the suburb or town is kept. No street, number or erf.</Text>
        {mine === "" ? null : <Text muted>{`Saved as ${mine}`}</Text>}
        {choices.length === 0 ? null : (
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                variant={yourArea === choice ? "primary" : "outline"}
                onPress={() => setYourArea(choice)}
              >
                {choice}
              </Button>
            ))}
          </View>
        )}
        <Input label="Suburb or town" value={yourArea} onChangeText={setYourArea} />
        <Button fullWidth disabled={busy || yourArea.trim() === ""} onPress={() => void saveArea()}>
          Save my suburb or town
        </Button>
      </View>
    </View>
  );
}
