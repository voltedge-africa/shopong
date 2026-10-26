import { ScrollView } from "react-native";
import { Text } from "panelui-native";

import { CommunityCard } from "../../components/CommunityCard";
import { PlacesCard } from "../../components/PlacesCard";
import { IdentityCard } from "../../components/IdentityCard";
import { TabScreen } from "../../components/TabScreen";

export default function Settings() {
  return (
    <TabScreen>
      <ScrollView contentContainerClassName="p-6 gap-6">
        <Text accessibilityRole="header" size="3xl" weight="bold">
          Settings
        </Text>
        <IdentityCard />
        <CommunityCard />
        <PlacesCard />
      </ScrollView>
    </TabScreen>
  );
}
