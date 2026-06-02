import prize100Image from '../assets/prize-100u-fast.webp'
import prize200Image from '../assets/prize-200u-fast.webp'
import prizePikachuImage from '../assets/prize-pikachu-fast.webp'

export type PrizeGalleryItem = {
  id: string
  catalogue: string
  title: string
  subtitle: string
  meta: Array<{ label: string; value: string }>
  accent: string
  imageSrc: string
}

export const PRIZE_GALLERY_ITEMS: PrizeGalleryItem[] = [
  {
    id: 'grand-prize',
    catalogue: '01 / Grand Prize',
    title: 'Van Gogh Pikachu PSA 10',
    subtitle: 'One winner receives the collector card prize.',
    meta: [
      { label: 'Reward', value: 'PSA 10 Card' },
      { label: 'Winners', value: '1' },
      { label: 'Source', value: 'Final Draw' },
    ],
    accent: '#2f89ff',
    imageSrc: prizePikachuImage,
  },
  {
    id: 'two-hundred-usdt',
    catalogue: '02 / Cash Prize',
    title: '200 USDT',
    subtitle: 'Ten winners receive 200 USDT each.',
    meta: [
      { label: 'Reward', value: '200 USDT' },
      { label: 'Winners', value: '10' },
      { label: 'Pool', value: '2,000 USDT' },
    ],
    accent: '#22c49c',
    imageSrc: prize200Image,
  },
  {
    id: 'one-hundred-usdt',
    catalogue: '03 / Cash Prize',
    title: '100 USDT',
    subtitle: 'Ten winners receive 100 USDT each.',
    meta: [
      { label: 'Reward', value: '100 USDT' },
      { label: 'Winners', value: '10' },
      { label: 'Pool', value: '1,000 USDT' },
    ],
    accent: '#f5b74b',
    imageSrc: prize100Image,
  },
]
