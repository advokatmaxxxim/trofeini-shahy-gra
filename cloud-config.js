// Налаштування Supabase. Обидва значення публічні: їх безпечно тримати в коді гри,
// бо дані захищають правила доступу в самій базі (supabase/migrations/0001_init.sql).
// Секретний ключ (service_role / secret) сюди не вписувати ніколи.
// Порожні значення - хмара вимкнена: гра працює як раніше (архів на пристрої, онлайн через ntfy.sh).
export const SUPABASE_URL = 'https://ymkbzjbxepchrncthits.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_leV9TmDl190DCsT6rutp5A_C623ec27';
