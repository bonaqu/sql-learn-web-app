import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type ActivityPoint = { day: string; solved: number };

export default function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const summary = data.map(point => `${point.day}: ${point.solved}`).join(', ');
  return <div className="activity-chart" role="img" aria-label={`Решённые задачи за неделю. ${summary}`}>
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Area type="monotone" dataKey="solved" stroke="#8b5cf6" fill="url(#fill)" strokeWidth={3} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
