import { ScrollView, View } from "react-native";
import { BarChart, Card, Kpi, LineChart, Text } from "panelui-native";

import { categories, formatRand, summarise, week } from "./data";

const summary = summarise(week);
const chartData = week.map((day) => ({ ...day }));
const categoryData = categories.map((entry) => ({ ...entry }));

export default function Insights() {
  return (
    <ScrollView contentContainerClassName="gap-6 p-6">
      <View className="gap-1">
        <Text accessibilityRole="header" size="3xl" weight="bold">
          Insights
        </Text>
        <Text muted>Demo data for the last 7 days.</Text>
      </View>

      <View className="gap-4">
        <View>
          <Kpi>
            <Kpi.Header>
              <Kpi.Title>Revenue</Kpi.Title>
            </Kpi.Header>
            <Kpi.Content>
              <Kpi.Value>{formatRand(summary.revenue)}</Kpi.Value>
              <Kpi.Trend value={summary.revenueTrend} />
            </Kpi.Content>
          </Kpi>
        </View>
        <View>
          <Kpi>
            <Kpi.Header>
              <Kpi.Title>Orders</Kpi.Title>
            </Kpi.Header>
            <Kpi.Content>
              <Kpi.Value>{String(summary.orders)}</Kpi.Value>
              <Kpi.Trend value={summary.ordersTrend} />
            </Kpi.Content>
          </Kpi>
        </View>
      </View>

      <Card className="gap-4 p-4">
        <Text weight="semibold">Revenue per day</Text>
        <LineChart data={chartData} xDataKey="day">
          <LineChart.Grid />
          <LineChart.Area dataKey="revenue" />
          <LineChart.Line dataKey="revenue" />
          <LineChart.XAxis />
          <LineChart.Tooltip formatValue={(value) => formatRand(value)} />
        </LineChart>
      </Card>

      <Card className="gap-4 p-4">
        <Text weight="semibold">Orders by category</Text>
        <BarChart data={categoryData} xDataKey="category">
          <BarChart.Grid />
          <BarChart.Bar dataKey="orders" />
          <BarChart.XAxis />
          <BarChart.Tooltip />
        </BarChart>
      </Card>
    </ScrollView>
  );
}
