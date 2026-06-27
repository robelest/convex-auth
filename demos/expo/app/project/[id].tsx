import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useOverlayRegistration } from "@/src/overlays";
import { colors, spacing, fontSize, lineHeight, radius, recipes } from "@/src/theme";
import { useGroupData } from "@/src/groups";

export default function ProjectWorkbenchScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { projects } = useGroupData();
  const project = projects.find((item) => item._id === id) ?? null;
  const [activeTab, setActiveTab] = React.useState<"overview" | "notes">(
    tab === "notes" ? tab : "overview",
  );
  const [notes, setNotes] = React.useState("");

  useOverlayRegistration(`project:${id}`);

  if (!project) {
    return <View style={{ flex: 1, backgroundColor: colors.warm[50] }} />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.warm[50] }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.sm + 2,
        paddingBottom: spacing["3xl"],
      }}
    >
      <Stack.Screen options={{ title: project.identifier }} />

      <View
        style={{
          ...recipes.card,
          gap: 2,
          paddingHorizontal: spacing.lg - 2,
          paddingVertical: spacing.md,
        }}
      >
        <Text
          selectable
          style={{
            fontSize: fontSize.xs,
            letterSpacing: 1.6,
            textTransform: "uppercase",
            color: colors.warm[400],
            fontWeight: "700",
          }}
        >
          {project.identifier}
        </Text>
        <Text
          selectable
          style={{
            fontSize: fontSize["2xl"],
            lineHeight: lineHeight["2xl"] - 2,
            color: colors.warm[900],
            fontWeight: "500",
          }}
        >
          {project.name}
        </Text>
        <Text
          selectable
          style={{
            fontSize: fontSize.sm,
            color: colors.warm[500],
            fontVariant: ["tabular-nums"],
          }}
        >
          {project.openIssueCount} open · {project.issueCounter} total
        </Text>
      </View>

      <View
        style={{
          ...recipes.segmentTrack,
          flexDirection: "row",
          padding: spacing.xs,
          gap: spacing.xs,
        }}
      >
        {(["overview", "notes"] as const).map((panel) => {
          const active = panel === activeTab;
          return (
            <Pressable
              key={panel}
              onPress={() => setActiveTab(panel)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: spacing.sm,
                alignItems: "center",
                ...(active
                  ? recipes.segmentActive
                  : {
                      borderRadius: radius.full,
                      backgroundColor: pressed ? colors.background.tertiary : "transparent",
                    }),
              })}
            >
              <Text
                selectable
                style={{
                  fontSize: 11,
                  color: active ? colors.content.primary : colors.warm[600],
                  fontWeight: "700",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {panel === "overview" ? "Overview" : "Notes"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "overview" ? (
        <View
          style={{
            ...recipes.card,
            padding: spacing.lg - 2,
            gap: spacing.sm + 2,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Text
              selectable
              style={{
                fontSize: fontSize.xs,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: colors.warm[400],
                fontWeight: "700",
              }}
            >
              Summary
            </Text>
          </View>
          <View style={{ gap: spacing.sm + 2 }}>
            {(
              [
                { label: "Open", value: String(project.openIssueCount), numeric: true },
                { label: "Total", value: String(project.issueCounter), numeric: true },
                { label: "Slug", value: project.slug, numeric: false },
                { label: "Status", value: project.status, numeric: false },
              ] as const
            ).map((item) => (
              <View key={item.label} style={{ gap: 2, paddingVertical: 2 }}>
                <Text
                  selectable
                  style={{
                    fontSize: fontSize.xs,
                    color: colors.warm[400],
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    fontWeight: "700",
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  selectable
                  numberOfLines={1}
                  style={{
                    fontSize: item.numeric ? fontSize.xl : fontSize.lg - 1,
                    lineHeight: item.numeric ? lineHeight.xl : lineHeight.md,
                    color: colors.warm[item.numeric ? 900 : 800],
                    fontVariant: item.numeric ? ["tabular-nums"] : undefined,
                    fontWeight: item.numeric ? "500" : "400",
                  }}
                >
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View
          style={{
            ...recipes.card,
            padding: spacing.lg - 2,
            gap: spacing.sm + 2,
          }}
        >
          <Text
            selectable
            style={{
              fontSize: fontSize.xs,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: colors.warm[400],
              fontWeight: "700",
            }}
          >
            Notes
          </Text>
          <TextInput
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="Track local notes, follow-up items, and handoff context here."
            placeholderTextColor={colors.warm[400]}
            style={{
              minHeight: 180,
              textAlignVertical: "top",
              color: colors.warm[800],
              fontSize: fontSize.lg - 1,
              lineHeight: lineHeight.lg,
            }}
          />
        </View>
      )}
    </ScrollView>
  );
}
