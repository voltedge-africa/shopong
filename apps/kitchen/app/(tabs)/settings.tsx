import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "panelui-native";

export default function Settings() {
  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="p-6 gap-6">
          <Text accessibilityRole="header" size="3xl" weight="bold">
            Settings
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
