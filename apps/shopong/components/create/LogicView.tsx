import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Circle, Defs, G, Path, Pattern, Polygon, Rect } from "react-native-svg";
import { Button, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import type { Build, LogicKind } from "../../lib/builder";
import {
  NODE_SIZE,
  clampZoom,
  defaultZoom,
  dotGap,
  fitZoom,
  graphBounds,
  graphEdges,
  gridOffset,
  nodeRect,
} from "../../lib/logicGraph";

const KIND_LABEL: Record<LogicKind, string> = {
  trigger: "Starts when",
  step: "Step",
  decision: "Decision",
  action: "Does",
};

const ZOOM_STEP = 1.25;

/** The dotted background. It fills the canvas and its dots move with the graph as it scrolls. */
function DotGrid({
  width,
  height,
  gap,
  x,
  y,
  color,
}: {
  width: number;
  height: number;
  gap: number;
  x: number;
  y: number;
  color: string;
}) {
  return (
    <Svg width={width} height={height} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="dots" x={x} y={y} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <Circle cx={gap / 2} cy={gap / 2} r={1.3} fill={color} opacity={0.4} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#dots)" />
    </Svg>
  );
}

/**
 * The build's logic as nodes and edges. Nodes are positioned views and the edges are one SVG sized
 * to the graph, so the largest bitmap is the graph itself. (PanelUI's `Flow` sizes its SVG layers
 * at four times the container, which is over Android's 100 MB bitmap limit on a phone and crashes
 * the app.) Scroll to pan; the buttons zoom. It opens at a zoom set by the size of a node, so the
 * text can be read, and the dotted background fills all the space it is given.
 */
export function LogicView({ build }: { build: Pick<Build, "nodes" | "edges"> }) {
  const [primary, line, foreground] = useCSSVariable([
    "--color-primary",
    "--color-muted-foreground",
    "--color-foreground",
  ]) as [string, string, string];
  const [size, setSize] = useState<{ width: number; height: number } | undefined>();
  /** Undefined means the zoom set by the size of a node. */
  const [zoom, setZoom] = useState<number | undefined>();
  const [scroll, setScroll] = useState({ x: 0, y: 0 });

  const bounds = useMemo(() => graphBounds(build.nodes), [build.nodes]);
  const edges = useMemo(() => graphEdges(build.nodes, build.edges), [build.nodes, build.edges]);

  const scale = zoom ?? (size ? defaultZoom(bounds, size) : 1);
  const gap = dotGap(scale);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current?.width === width && current.height === height ? current : { width, height },
    );
  };

  const onScrollY = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    setScroll((current) => (current.y === y ? current : { ...current, y }));
  };
  const onScrollX = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    setScroll((current) => (current.x === x ? current : { ...current, x }));
  };

  return (
    <View className="flex-1" onLayout={onLayout}>
      {size ? (
        <DotGrid
          width={size.width}
          height={size.height}
          gap={gap}
          x={gridOffset(size.width, bounds.width * scale, scroll.x, gap)}
          y={gridOffset(size.height, bounds.height * scale, scroll.y, gap)}
          color={line}
        />
      ) : null}
      {size ? (
        <ScrollView
          nestedScrollEnabled
          onScroll={onScrollY}
          scrollEventThrottle={16}
          contentContainerStyle={{ minHeight: size.height, justifyContent: "center" }}
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            onScroll={onScrollX}
            scrollEventThrottle={16}
            // It fills the canvas, so the whole canvas pans and the graph is centred inside it.
            style={{ flexGrow: 1 }}
            contentContainerStyle={{
              minWidth: size.width,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* The scrollable area is the scaled size; the graph inside is laid out at full size. */}
            <View style={{ width: bounds.width * scale, height: bounds.height * scale }}>
              <View
                style={{
                  width: bounds.width,
                  height: bounds.height,
                  transformOrigin: "top left",
                  transform: [{ scale }],
                }}
              >
                <Svg
                  width={bounds.width}
                  height={bounds.height}
                  pointerEvents="none"
                  style={{ position: "absolute", left: 0, top: 0 }}
                >
                  {edges.map((edge) => {
                    const color = edge.label === "yes" ? primary : line;
                    return (
                      <G key={`${edge.from}-${edge.to}`}>
                        <Path
                          d={edge.d}
                          stroke={color}
                          strokeWidth={2}
                          fill="none"
                          strokeDasharray={edge.dashed ? "6 5" : undefined}
                        />
                        <Polygon points={edge.arrow} fill={color} />
                      </G>
                    );
                  })}
                </Svg>
                {build.nodes.map((node) => {
                  const rect = nodeRect(node);
                  return (
                    <View
                      key={node.id}
                      accessible
                      accessibilityLabel={`${KIND_LABEL[node.kind]}: ${node.label}`}
                      style={{
                        position: "absolute",
                        left: rect.x,
                        top: rect.y,
                        width: NODE_SIZE.width,
                        height: NODE_SIZE.height,
                      }}
                      className={
                        node.kind === "decision"
                          ? "justify-center gap-0.5 rounded-xl border-2 border-primary bg-card px-3"
                          : "justify-center gap-0.5 rounded-xl border border-border bg-card px-3"
                      }
                    >
                      <Text size="xs" muted>
                        {KIND_LABEL[node.kind]}
                      </Text>
                      <Text weight="semibold" numberOfLines={2}>
                        {node.label}
                      </Text>
                    </View>
                  );
                })}
                {edges
                  .filter((edge) => edge.label)
                  .map((edge) => (
                    <View
                      key={`label-${edge.from}-${edge.to}`}
                      accessible
                      accessibilityLabel={`Edge: ${edge.label}`}
                      style={{ position: "absolute", left: edge.mid.x - 16, top: edge.mid.y - 11 }}
                      className="rounded-full border border-border bg-background px-2 py-0.5"
                    >
                      <Text size="xs" weight="medium">
                        {edge.label}
                      </Text>
                    </View>
                  ))}
              </View>
            </View>
          </ScrollView>
        </ScrollView>
      ) : null}
      <View className="absolute bottom-4 right-4 gap-2">
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel="Zoom in"
          onPress={() => setZoom(clampZoom(scale * ZOOM_STEP))}
        >
          <Ionicons name="add" size={22} color={foreground} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel="Zoom out"
          onPress={() => setZoom(clampZoom(scale / ZOOM_STEP))}
        >
          <Ionicons name="remove" size={22} color={foreground} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel="Fit to screen"
          onPress={() => {
            if (!size) return;
            setZoom(fitZoom(bounds, size));
            setScroll({ x: 0, y: 0 });
          }}
        >
          <Ionicons name="scan-outline" size={20} color={foreground} />
        </Button>
      </View>
    </View>
  );
}
