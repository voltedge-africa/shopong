import { ScrollView, View, useColorScheme } from "react-native";
import { SvgXml } from "react-native-svg";

import { sequenceLayout, sequenceSvg, type SequenceDiagram } from "../../lib/uml";

/** A UML sequence diagram, drawn from data, in the colours of the current theme. */
export function UmlImage({ diagram, label }: { diagram: SequenceDiagram; label: string }) {
  const theme = useColorScheme() === "dark" ? "dark" : "light";
  const { width, height } = sequenceLayout(diagram);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={label}>
      <View className="overflow-hidden rounded-xl border border-border" style={{ width, height }}>
        <SvgXml xml={sequenceSvg(diagram, theme)} width={width} height={height} />
      </View>
    </ScrollView>
  );
}
