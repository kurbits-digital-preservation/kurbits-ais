import { Users } from 'lucide-react'
import styles from './PlaceholderPage.module.css'

export function AgentsPage() {
  return <PlaceholderPage icon={Users} title="Agents" description="Person, organization, and family records coming soon." />
}

import { MapPin } from 'lucide-react'
export function LocationsPage() {
  return <PlaceholderPage icon={MapPin} title="Locations" description="Physical storage management coming soon." />
}

import { Tag } from 'lucide-react'
export function ClassificationsPage() {
  return <PlaceholderPage icon={Tag} title="Classifications" description="Subject classification schemes coming soon." />
}

function PlaceholderPage({ icon: Icon, title, description }: {
  icon: React.ComponentType<any>
  title: string
  description: string
}) {
  return (
    <div className={styles.page}>
      <Icon size={32} className={styles.icon} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
