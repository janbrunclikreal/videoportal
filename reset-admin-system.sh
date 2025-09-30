#!/bin/bash

# Reset admin hesla pomocí systémového SQLite3

echo "🔐 Reset admin hesla..."

# Kontrola existence databáze
if [ ! -f "database/videoportal.db" ]; then
    echo "❌ Databáze database/videoportal.db nebyla nalezena!"
    exit 1
fi

# Jednoduchý hash (SHA256) - POUZE PRO TESTOVÁNÍ!
NEW_PASSWORD="admin123"
HASHED_PASSWORD=$(echo -n "${NEW_PASSWORD}salt" | sha256sum | cut -d' ' -f1)

echo "Nové heslo: $NEW_PASSWORD"
echo "Hash: $HASHED_PASSWORD"

# Kontrola existence admin uživatele
ADMIN_EXISTS=$(sqlite3 database/videoportal.db "SELECT COUNT(*) FROM users WHERE username = 'admin';")

if [ "$ADMIN_EXISTS" -eq 0 ]; then
    echo "📝 Vytvářím nového admin uživatele..."
    
    # Vytvoření admin uživatele
    sqlite3 database/videoportal.db "
    INSERT INTO users (username, email, password, created_at) 
    VALUES ('admin', 'admin@example.com', '$HASHED_PASSWORD', datetime('now'));
    "
    
    # Získání ID nového uživatele
    USER_ID=$(sqlite3 database/videoportal.db "SELECT id FROM users WHERE username = 'admin';")
    
    # Přiřazení admin role
    sqlite3 database/videoportal.db "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ($USER_ID, 4);"
    
    echo "✅ Admin uživatel vytvořen s ID: $USER_ID"
else
    echo "👤 Admin uživatel existuje, resetuji heslo..."
    
    # Reset hesla
    sqlite3 database/videoportal.db "UPDATE users SET password = '$HASHED_PASSWORD' WHERE username = 'admin';"
    
    # Ujistíme se, že má admin roli
    USER_ID=$(sqlite3 database/videoportal.db "SELECT id FROM users WHERE username = 'admin';")
    sqlite3 database/videoportal.db "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ($USER_ID, 4);"
    
    echo "✅ Heslo resetováno"
fi

echo ""
echo "🔑 Přihlašovací údaje:"
echo "   Username: admin"
echo "   Password: admin123"
echo ""
echo "⚠️  POZOR: Používá se SHA256 hash - změňte heslo po přihlášení!"
echo "💡 Pro produkci nainstalujte bcrypt: npm install bcrypt"