package main

// The example catalog. Drafted with an AI assistant from a prompt like
// "realistic products for an Indonesian online shop in these categories,
// prices in whole rupiah, weights in grams", then checked by hand: every
// SKU is upper case and unique, every price is above 0, and each category
// slug exists in category.SeedCategories.

// seedProduct is one product with its variants, as the seed inserts it.
type seedProduct struct {
	category    string // category slug
	slug        string
	name        string
	description string
	variants    []seedVariant
}

// seedVariant is one variant. archived variants show that the storefront
// leaves them out of the variant list, price_from and in_stock.
type seedVariant struct {
	sku      string
	name     string
	price    int64 // whole rupiah
	stock    int32
	weight   int32 // grams
	archived bool
}

var catalog = []seedProduct{
	// Pakaian → Kaos
	{"kaos", "kaos-polos-hitam", "Kaos Polos Hitam", "Kaos katun combed 30s, nyaman dipakai sehari-hari.", []seedVariant{
		{"KPH-S", "S", 89000, 15, 180, false},
		{"KPH-M", "M", 89000, 12, 200, false},
		{"KPH-L", "L", 89000, 8, 210, false},
		{"KPH-XL", "XL", 99000, 0, 230, false},
		{"KPH-XXL", "XXL", 109000, 3, 250, true},
	}},
	{"kaos", "kaos-polos-putih", "Kaos Polos Putih", "Kaos katun combed 30s warna putih bersih, jahitan rantai di bahu.", []seedVariant{
		{"KPP-M", "M", 89000, 20, 200, false},
		{"KPP-L", "L", 89000, 14, 210, false},
	}},
	{"kaos", "kaos-grafis-batik-mega-mendung", "Kaos Grafis Batik Mega Mendung", "Kaos sablon motif mega mendung khas Cirebon, tinta plastisol tidak mudah luntur.", []seedVariant{
		{"KGB-M", "M", 129000, 6, 210, false},
		{"KGB-L", "L", 129000, 4, 220, false},
	}},
	{"kaos", "kaos-oversize-abu-abu", "Kaos Oversize Abu-abu", "Potongan oversize dengan bahan cotton fleece ringan, cocok untuk gaya santai.", []seedVariant{
		{"KOA-M", "M", 149000, 9, 260, false},
		{"KOA-L", "L", 149000, 7, 270, false},
		{"KOA-XL", "XL", 159000, 2, 290, false},
	}},
	// Pakaian → Kemeja
	{"kemeja", "kemeja-batik-parang", "Kemeja Batik Lengan Panjang Parang", "Kemeja batik cap motif parang, bahan katun primisima, cocok untuk kondangan dan kantor.", []seedVariant{
		{"KBP-M", "M", 275000, 5, 320, false},
		{"KBP-L", "L", 275000, 5, 330, false},
		{"KBP-XL", "XL", 295000, 1, 350, false},
	}},
	{"kemeja", "kemeja-flanel-kotak-merah", "Kemeja Flanel Kotak Merah", "Flanel tebal motif kotak-kotak, hangat dipakai saat hujan.", []seedVariant{
		{"KFM-M", "M", 199000, 10, 380, false},
		{"KFM-L", "L", 199000, 6, 400, false},
	}},
	{"kemeja", "kemeja-linen-putih", "Kemeja Linen Putih", "Kemeja linen adem dengan kerah mandarin, pas untuk cuaca tropis.", []seedVariant{
		{"KLP-M", "M", 239000, 4, 250, false},
		{"KLP-L", "L", 239000, 3, 260, false},
	}},
	// Pakaian → Celana
	{"celana", "celana-chino-krem", "Celana Chino Krem", "Chino katun stretch warna krem, potongan regular fit.", []seedVariant{
		{"CCK-30", "30", 219000, 7, 450, false},
		{"CCK-32", "32", 219000, 9, 470, false},
		{"CCK-34", "34", 219000, 5, 490, false},
	}},
	{"celana", "celana-jeans-slim-fit-biru", "Celana Jeans Slim Fit Biru", "Denim 12 oz dengan sedikit elastan, nyaman dipakai seharian.", []seedVariant{
		{"CJS-30", "30", 289000, 3, 600, false},
		{"CJS-32", "32", 289000, 6, 620, false},
		{"CJS-34", "34", 299000, 2, 640, false},
	}},
	{"celana", "celana-pendek-kargo-hijau-army", "Celana Pendek Kargo Hijau Army", "Celana pendek kargo enam kantong, bahan ripstop. Sedang habis, segera restok.", []seedVariant{
		{"CPK-M", "M", 159000, 0, 350, false},
		{"CPK-L", "L", 159000, 0, 360, false},
	}},
	// Elektronik → Ponsel
	{"ponsel", "ponsel-android-128gb", "Ponsel Android 6,5 inci 128 GB", "Layar 6,5 inci 90 Hz, RAM 6 GB, baterai 5000 mAh, garansi resmi satu tahun.", []seedVariant{
		{"PA128-HITAM", "Hitam", 2499000, 11, 400, false},
		{"PA128-BIRU", "Biru", 2499000, 4, 400, false},
	}},
	{"ponsel", "ponsel-android-256gb", "Ponsel Android 6,7 inci 256 GB", "Layar AMOLED 6,7 inci, RAM 8 GB, kamera 50 MP, pengisian cepat 33 W.", []seedVariant{
		{"PA256-HITAM", "Hitam", 3299000, 6, 420, false},
		{"PA256-HIJAU", "Hijau", 3299000, 2, 420, false},
	}},
	// Elektronik → Aksesoris Ponsel
	{"aksesoris-ponsel", "casing-silikon-bening", "Casing Silikon Bening", "Casing TPU bening anti kuning dengan sudut anti benturan.", []seedVariant{
		{"CSB-STD", "Standar", 35000, 120, 50, false},
	}},
	{"aksesoris-ponsel", "kabel-data-usb-c", "Kabel Data USB-C", "Kabel USB-C ke USB-C berlapis nilon, mendukung pengisian cepat 60 W.", []seedVariant{
		{"KDC-1M", "1 meter", 45000, 80, 60, false},
		{"KDC-2M", "2 meter", 59000, 40, 90, false},
	}},
	{"aksesoris-ponsel", "pengisi-daya-cepat-20w", "Pengisi Daya Cepat 20 W", "Kepala charger USB-C 20 W dengan perlindungan suhu berlebih.", []seedVariant{
		{"PDC-20W", "20 W", 129000, 35, 120, false},
	}},
	{"aksesoris-ponsel", "power-bank-10000mah", "Power Bank 10000 mAh", "Power bank ringkas dua port, cukup untuk dua kali isi ulang ponsel.", []seedVariant{
		{"PB10K-HITAM", "Hitam", 199000, 18, 230, false},
		{"PB10K-PUTIH", "Putih", 199000, 9, 230, false},
	}},
	// Rumah Tangga → Peralatan Dapur
	{"peralatan-dapur", "wajan-anti-lengket", "Wajan Anti Lengket", "Wajan aluminium berlapis keramik, aman untuk kompor gas dan induksi.", []seedVariant{
		{"WAL-24", "24 cm", 189000, 12, 900, false},
		{"WAL-28", "28 cm", 229000, 8, 1100, false},
	}},
	{"peralatan-dapur", "set-pisau-dapur-stainless", "Set Pisau Dapur Stainless 5 in 1", "Lima pisau baja tahan karat lengkap dengan balok kayu penyimpan.", []seedVariant{
		{"SPD-5", "5 pisau", 159000, 10, 1300, false},
	}},
	{"peralatan-dapur", "rice-cooker-1-8-liter", "Rice Cooker 1,8 Liter", "Penanak nasi digital dengan fungsi penghangat 24 jam dan panci anti lengket.", []seedVariant{
		{"RC-18", "1,8 liter", 349000, 7, 3000, false},
	}},
	// Rumah Tangga → Dekorasi Rumah
	{"dekorasi-rumah", "lampu-tidur-rotan", "Lampu Tidur Rotan", "Kap lampu anyaman rotan buatan pengrajin Cirebon, cahaya hangat untuk kamar.", []seedVariant{
		{"LTR-STD", "Standar", 129000, 14, 700, false},
	}},
	{"dekorasi-rumah", "tanaman-hias-artifisial-monstera", "Tanaman Hias Artifisial Monstera", "Monstera tiruan setinggi 60 cm dalam pot semen, tidak perlu disiram.", []seedVariant{
		{"THA-60", "60 cm", 99000, 16, 900, false},
	}},
	{"dekorasi-rumah", "bingkai-foto-kayu-jati", "Bingkai Foto Kayu Jati", "Bingkai foto dari kayu jati Jepara dengan kaca akrilik.", []seedVariant{
		{"BFK-4R", "4R", 39000, 30, 250, false},
		{"BFK-10R", "10R", 79000, 12, 600, false},
	}},
	// Makanan & Minuman → Kopi & Teh
	{"kopi-teh", "kopi-arabika-gayo-250g", "Kopi Arabika Gayo 250 g", "Kopi arabika dari dataran tinggi Gayo, Aceh, sangrai medium dengan aroma rempah.", []seedVariant{
		{"KAG-BIJI", "Biji", 95000, 25, 270, false},
		{"KAG-BUBUK", "Bubuk", 95000, 22, 270, false},
	}},
	{"kopi-teh", "kopi-robusta-lampung-500g", "Kopi Robusta Lampung 500 g", "Robusta Lampung sangrai gelap, pahit tegas, cocok untuk kopi tubruk.", []seedVariant{
		{"KRL-500", "500 g", 85000, 40, 520, false},
	}},
	{"kopi-teh", "teh-hijau-melati-50-kantong", "Teh Hijau Melati 50 Kantong", "Teh hijau dengan bunga melati asli, satu kotak berisi 50 kantong celup.", []seedVariant{
		{"THM-50", "50 kantong", 32000, 60, 150, false},
	}},
	// Makanan & Minuman → Camilan
	{"camilan", "keripik-singkong-balado-200g", "Keripik Singkong Balado 200 g", "Keripik singkong renyah dengan bumbu balado pedas manis khas Padang.", []seedVariant{
		{"KSB-200", "200 g", 18000, 75, 220, false},
	}},
	{"camilan", "kacang-mete-panggang-250g", "Kacang Mete Panggang 250 g", "Mete utuh dari Wonogiri, dipanggang tanpa minyak dan sedikit garam.", []seedVariant{
		{"KMP-250", "250 g", 75000, 20, 270, false},
	}},
	{"camilan", "rengginang-terasi-250g", "Rengginang Terasi 250 g", "Rengginang ketan rasa terasi, siap digoreng di rumah.", []seedVariant{
		{"RT-250", "250 g", 25000, 0, 270, false},
		{"RT-500", "500 g", 45000, 12, 520, false},
	}},
}

// Made-up brands and editions for the generated products (-generated).
var (
	brands = []string{
		"Nusantara", "Garuda", "Merapi", "Rinjani", "Kencana", "Samudra", "Bintang", "Cendana",
		"Pelangi", "Mahakam", "Bromo", "Toba", "Kartika", "Lembayung", "Arunika", "Sekar",
	}
	editions = []string{
		"Klasik", "Premium", "Eksklusif", "Harian", "Lite", "Pro", "Lebaran", "Ramadan",
		"Musim Hujan", "Terlaris", "Hemat", "Kolaborasi",
	}
)
