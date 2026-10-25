import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";

export default function Addons() {
  const router = useRouter();
  const iconColor = useCSSVariable("--color-foreground") as string;

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add an add-on"
        onPress={() => router.push("/thinking")}
        className="h-24 w-24 items-center justify-center rounded-full border border-border bg-card"
      >
        <Ionicons name="add" size={48} color={iconColor} />
      </Pressable>
    </View>
  );
}
