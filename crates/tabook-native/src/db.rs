//! Database layer — Rust port of `src/db/db.ts` (721 LOC).
//!
//! rusqlite with bundled SQLite. Migrations v1..v5. Prepared statements.
//! Bugfix from audit: addBook uses last_insert_rowid() directly instead of
//! re-querying by path (race condition with UNIQUE constraint).

use crate::model::{Author, BookMetadata, SeriesInfo};
use rusqlite::{params, Connection};
use std::sync::Mutex;

const SCHEMA_VERSION: i32 = 5;

pub struct LibraryDb {
    pub conn: Mutex<Connection>,
    pub file_path: String,
}

#[derive(Debug, Clone)]
pub struct BookRecord {
    pub id: i32,
    pub path: String,
    pub filename: String,
    pub format: String,
    pub size: i64,
    pub title: String,
    pub authors: Vec<Author>,
    pub series: Option<SeriesInfo>,
    pub genres: Vec<String>,
    pub annotation: String,
    pub lang: Option<String>,
    pub cover_key: Option<String>,
    pub publisher: Option<String>,
    pub isbn: Option<String>,
    pub year: Option<f64>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub progress_percent: Option<f64>,
    pub progress_position: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct BookmarkRecord {
    pub id: i32,
    pub book_id: i32,
    pub position: i64,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ProgressRecord {
    pub book_id: i32,
    pub position: i64,
    pub percent: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct HistoryRecord {
    pub book_id: i32,
    pub title: String,
    pub opened_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionStats {
    pub total_seconds: i64,
    pub total_pages: i64,
    pub session_count: i64,
    pub last_read_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CatalogRecord {
    pub id: i32,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LibraryFolderRecord {
    pub id: i32,
    pub path: String,
    pub added_at: String,
    pub last_scanned_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ScanSummary {
    pub total: i32,
    pub added: i32,
    pub updated: i32,
    pub removed: i32,
    pub failed: i32,
    pub errors: Vec<String>,
}

impl LibraryDb {
    pub fn open(file_path: &str) -> Result<Self, String> {
        let parent = std::path::Path::new(file_path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !parent.is_empty() {
            std::fs::create_dir_all(&parent)
                .map_err(|e| format!("Cannot create dir {parent}: {e}"))?;
        }
        let conn = Connection::open(file_path)
            .map_err(|e| format!("Cannot open database at {file_path}: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
            file_path: file_path.to_owned(),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn close(&self) {
        // Connection is dropped when LibraryDb is dropped; explicit close not needed.
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        if version < 1 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    filename TEXT NOT NULL,
                    format TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL,
                    authors TEXT NOT NULL DEFAULT '',
                    series_name TEXT,
                    series_number REAL,
                    genres TEXT NOT NULL DEFAULT '',
                    annotation TEXT NOT NULL DEFAULT '',
                    lang TEXT,
                    cover_key TEXT,
                    publisher TEXT,
                    isbn TEXT,
                    year INTEGER,
                    added_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_opened_at TEXT
                );
                CREATE TABLE IF NOT EXISTS reading_progress (
                    book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL DEFAULT 0,
                    percent REAL NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS bookmarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
                CREATE TABLE IF NOT EXISTS reading_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    pages_read INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_book ON reading_sessions(book_id);
                CREATE TABLE IF NOT EXISTS history (
                    book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                    opened_at TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .map_err(|e| e.to_string())?;
        }
        if version < 2 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS opds_catalogs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    username TEXT,
                    password TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .map_err(|e| e.to_string())?;
        }
        if version < 3 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS library_folders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    added_at TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .map_err(|e| e.to_string())?;
            // ALTER TABLE has no IF NOT EXISTS; guard against a partially
            // applied migration or a rollback of user_version on a DB that
            // already has the column (mirrors the TS fallback's PRAGMA check).
            let cols: Vec<String> = conn
                .prepare("PRAGMA table_info(books)")
                .map_err(|e| e.to_string())?
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            if !cols.iter().any(|c| c == "library_root") {
                conn.execute("ALTER TABLE books ADD COLUMN library_root TEXT", [])
                    .map_err(|e| e.to_string())?;
            }
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_books_library_root ON books(library_root);",
            )
            .map_err(|e| e.to_string())?;
        }
        if version < 4 {
            // ALTER TABLE library_folders ADD COLUMN last_scanned_at INTEGER
            let cols: Vec<String> = conn
                .prepare("PRAGMA table_info(library_folders)")
                .map_err(|e| e.to_string())?
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            if !cols.iter().any(|c| c == "last_scanned_at") {
                conn.execute(
                    "ALTER TABLE library_folders ADD COLUMN last_scanned_at INTEGER",
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        if version < 5 {
            // Seed Flibusta for existing users
            let count: i32 = conn
                .query_row("SELECT COUNT(*) FROM opds_catalogs", [], |r| r.get(0))
                .unwrap_or(0);
            if count > 0 {
                let has_flibusta: i32 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM opds_catalogs WHERE url = 'https://flibusta.is/opds'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if has_flibusta == 0 {
                    conn.execute(
                        "INSERT INTO opds_catalogs (name, url) VALUES ('Flibusta', 'https://flibusta.is/opds')",
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn file_exists(&self) -> bool {
        std::path::Path::new(&self.file_path).exists()
    }

    // ---- Books ----

    pub fn add_book(
        &self,
        path: &str,
        filename: &str,
        format: &str,
        size: i64,
        metadata: &BookMetadata,
        library_root: Option<&str>,
    ) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        let authors_line = metadata
            .authors
            .iter()
            .map(|a| {
                format!(
                    "{}\t{}\t{}\t{}",
                    a.first_name,
                    a.last_name,
                    a.middle_name.as_deref().unwrap_or(""),
                    a.nickname.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let genres_line = metadata.genres.join("\n");
        conn.execute(
            "INSERT INTO books (path, filename, format, size, title, authors, series_name, series_number,
             genres, annotation, lang, cover_key, publisher, isbn, year, library_root)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
               filename=excluded.filename, format=excluded.format, size=excluded.size,
               title=excluded.title, authors=excluded.authors, series_name=excluded.series_name,
               series_number=excluded.series_number, genres=excluded.genres, annotation=excluded.annotation,
               lang=excluded.lang, cover_key=excluded.cover_key, publisher=excluded.publisher,
               isbn=excluded.isbn, year=excluded.year,
               library_root=COALESCE(excluded.library_root, books.library_root)",
            params![
                path, filename, format, size, metadata.title, authors_line,
                metadata.series.as_ref().map(|s| s.name.clone()),
                metadata.series.as_ref().and_then(|s| s.number),
                genres_line, metadata.annotation,
                metadata.lang, metadata.cover_key, metadata.publisher, metadata.isbn, metadata.year,
                library_root,
            ],
        ).map_err(|e| e.to_string())?;
        // Bugfix: use last_insert_rowid() instead of re-querying by path
        let id = conn.last_insert_rowid() as i32;
        Ok(id)
    }

    pub fn get_book(&self, id: i32) -> Result<Option<BookRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT b.*, p.position, p.percent FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id WHERE b.id = ?")
            .map_err(|e| e.to_string())?;
        let row = stmt.query_row(params![id], row_to_book).ok();
        Ok(row)
    }

    pub fn get_book_by_path(&self, path: &str) -> Result<Option<BookRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT b.*, p.position, p.percent FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id WHERE b.path = ?")
            .map_err(|e| e.to_string())?;
        let row = stmt.query_row(params![path], row_to_book).ok();
        Ok(row)
    }

    pub fn list_books(
        &self,
        limit: Option<i32>,
        offset: i32,
        order_by: &str,
    ) -> Result<Vec<BookRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let order = match order_by {
            "opened" => "ORDER BY b.last_opened_at DESC NULLS LAST, b.title",
            "added" => "ORDER BY b.added_at DESC, b.title",
            _ => "ORDER BY b.title",
        };
        let sql = format!(
            "SELECT b.*, p.position, p.percent FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id {order} {}",
            if limit.is_some() { "LIMIT ? OFFSET ?" } else { "" }
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = if let Some(l) = limit {
            stmt.query_map(params![l, offset], row_to_book)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect()
        } else {
            stmt.query_map([], row_to_book)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect()
        };
        Ok(rows)
    }

    pub fn remove_book(&self, id: i32) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute("DELETE FROM books WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    // ---- Progress ----

    pub fn set_progress(&self, book_id: i32, position: i64, percent: f64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO reading_progress (book_id, position, percent, updated_at) VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(book_id) DO UPDATE SET position=excluded.position, percent=excluded.percent, updated_at=excluded.updated_at",
            params![book_id, position, percent],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_progress(&self, book_id: i32) -> Result<Option<ProgressRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT book_id, position, percent, updated_at FROM reading_progress WHERE book_id = ?",
                params![book_id],
                |r| {
                    Ok(ProgressRecord {
                        book_id: r.get(0)?,
                        position: r.get(1)?,
                        percent: r.get(2)?,
                        updated_at: r.get(3)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    // ---- Bookmarks ----

    pub fn add_bookmark(&self, book_id: i32, position: i64, label: &str) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO bookmarks (book_id, position, label, created_at) VALUES (?, ?, ?, datetime('now'))",
            params![book_id, position, label],
        ).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid() as i32)
    }

    pub fn list_bookmarks(&self, book_id: i32) -> Result<Vec<BookmarkRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, book_id, position, label, created_at FROM bookmarks WHERE book_id = ? ORDER BY position ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![book_id], |r| {
                Ok(BookmarkRecord {
                    id: r.get(0)?,
                    book_id: r.get(1)?,
                    position: r.get(2)?,
                    label: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn get_bookmark(&self, id: i32) -> Result<Option<BookmarkRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, book_id, position, label, created_at FROM bookmarks WHERE id = ?",
                params![id],
                |r| {
                    Ok(BookmarkRecord {
                        id: r.get(0)?,
                        book_id: r.get(1)?,
                        position: r.get(2)?,
                        label: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    pub fn delete_bookmark(&self, id: i32) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute("DELETE FROM bookmarks WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    pub fn update_bookmark_label(&self, id: i32, label: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute(
                "UPDATE bookmarks SET label = ? WHERE id = ?",
                params![label, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    // ---- History ----

    pub fn record_open(&self, book_id: i32) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO history (book_id, opened_at) VALUES (?, datetime('now'))
             ON CONFLICT(book_id) DO UPDATE SET opened_at=excluded.opened_at",
            params![book_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE books SET last_opened_at = datetime('now') WHERE id = ?",
            params![book_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_history(&self, limit: i32) -> Result<Vec<HistoryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT h.book_id, h.opened_at, b.title FROM history h JOIN books b ON b.id = h.book_id ORDER BY h.opened_at DESC LIMIT ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(HistoryRecord {
                    book_id: r.get(0)?,
                    opened_at: r.get(1)?,
                    title: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn list_recent_books(&self, limit: i32) -> Result<Vec<BookRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT b.*, p.position, p.percent FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id WHERE b.last_opened_at IS NOT NULL ORDER BY b.last_opened_at DESC LIMIT ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], row_to_book)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    // Books currently being read (progress started but not finished), most
    // recently touched first — the "continue reading" list.
    pub fn list_continue_books(&self, limit: i32) -> Result<Vec<BookRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT b.*, p.position, p.percent FROM books b JOIN reading_progress p ON p.book_id = b.id WHERE p.percent > 0 AND p.percent < 100 ORDER BY p.updated_at DESC LIMIT ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], row_to_book)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    // ---- Sessions ----

    pub fn start_session(&self, book_id: i32) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO reading_sessions (book_id, started_at) VALUES (?, datetime('now'))",
            params![book_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid() as i32)
    }

    pub fn end_session(&self, session_id: i32, pages_read: i32) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE reading_sessions SET ended_at = datetime('now'), pages_read = ? WHERE id = ?",
            params![pages_read, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_stats(&self, book_id: i32) -> Result<SessionStats, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT COUNT(*),
                 COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN
                   CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER) ELSE 0 END), 0),
                 COALESCE(SUM(pages_read), 0),
                 MAX(COALESCE(ended_at, started_at))
                 FROM reading_sessions WHERE book_id = ?",
                params![book_id],
                |r| {
                    Ok(SessionStats {
                        session_count: r.get(0)?,
                        total_seconds: r.get(1)?,
                        total_pages: r.get(2)?,
                        last_read_at: r.get(3)?,
                    })
                },
            )
            .unwrap_or(SessionStats {
                session_count: 0,
                total_seconds: 0,
                total_pages: 0,
                last_read_at: None,
            });
        Ok(row)
    }

    // ---- OPDS Catalogs ----

    pub fn add_catalog(
        &self,
        name: &str,
        url: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO opds_catalogs (name, url, username, password) VALUES (?, ?, ?, ?)",
            params![name, url, username, password],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid() as i32)
    }

    pub fn list_catalogs(&self) -> Result<Vec<CatalogRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, url, username, password FROM opds_catalogs ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CatalogRecord {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    url: r.get(2)?,
                    username: r.get(3)?,
                    password: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn get_catalog(&self, id: i32) -> Result<Option<CatalogRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, name, url, username, password FROM opds_catalogs WHERE id = ?",
                params![id],
                |r| {
                    Ok(CatalogRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        url: r.get(2)?,
                        username: r.get(3)?,
                        password: r.get(4)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    pub fn get_catalog_by_name(&self, name: &str) -> Result<Option<CatalogRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, name, url, username, password FROM opds_catalogs WHERE name = ?",
                params![name],
                |r| {
                    Ok(CatalogRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        url: r.get(2)?,
                        username: r.get(3)?,
                        password: r.get(4)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// Partial update matching the TS `updateCatalog(id, fields)`: only the
    /// provided fields are set; `None` fields are left untouched.
    pub fn update_catalog(
        &self,
        id: i32,
        name: Option<&str>,
        url: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let mut sets: Vec<String> = Vec::new();
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(v) = name {
            sets.push("name = ?".to_string());
            values.push(rusqlite::types::Value::Text(v.to_owned()));
        }
        if let Some(v) = url {
            sets.push("url = ?".to_string());
            values.push(rusqlite::types::Value::Text(v.to_owned()));
        }
        if let Some(v) = username {
            sets.push("username = ?".to_string());
            values.push(rusqlite::types::Value::Text(v.to_owned()));
        }
        if let Some(v) = password {
            sets.push("password = ?".to_string());
            values.push(rusqlite::types::Value::Text(v.to_owned()));
        }
        if sets.is_empty() {
            return Ok(());
        }
        let sql = format!("UPDATE opds_catalogs SET {} WHERE id = ?", sets.join(", "));
        values.push(rusqlite::types::Value::Integer(i64::from(id)));
        conn.execute(&sql, rusqlite::params_from_iter(values.iter()))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_catalog(&self, id: i32) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM opds_catalogs WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---- Library folders ----

    pub fn add_library_folder(&self, path: &str) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO library_folders (path) VALUES (?) ON CONFLICT(path) DO NOTHING",
            params![path],
        )
        .map_err(|e| e.to_string())?;
        let id: i32 = conn
            .query_row(
                "SELECT id FROM library_folders WHERE path = ?",
                params![path],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn list_library_folders(&self) -> Result<Vec<LibraryFolderRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, path, added_at, last_scanned_at FROM library_folders ORDER BY path",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(LibraryFolderRecord {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    added_at: r.get(2)?,
                    last_scanned_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn get_library_folder_by_path(
        &self,
        path: &str,
    ) -> Result<Option<LibraryFolderRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, path, added_at, last_scanned_at FROM library_folders WHERE path = ?",
                params![path],
                |r| {
                    Ok(LibraryFolderRecord {
                        id: r.get(0)?,
                        path: r.get(1)?,
                        added_at: r.get(2)?,
                        last_scanned_at: r.get(3)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    pub fn set_folder_scanned_at(&self, id: i32, scanned_at_ms: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE library_folders SET last_scanned_at = ? WHERE id = ?",
            params![scanned_at_ms, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_library_folder(&self, id: i32) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute("DELETE FROM library_folders WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    pub fn list_paths_by_library_root(&self, root: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT path FROM books WHERE library_root = ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![root], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn remove_books_by_paths(&self, paths: &[String]) -> Result<i32, String> {
        if paths.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let mut removed = 0i32;
        for p in paths {
            removed += conn
                .execute("DELETE FROM books WHERE path = ?", params![p])
                .map_err(|e| e.to_string())? as i32;
        }
        Ok(removed)
    }

    pub fn remove_books_by_library_root(&self, root: &str) -> Result<i32, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute("DELETE FROM books WHERE library_root = ?", params![root])
            .map_err(|e| e.to_string())?;
        Ok(n as i32)
    }
}

fn row_to_book(r: &rusqlite::Row) -> rusqlite::Result<BookRecord> {
    let id: i32 = r.get("id")?;
    let path: String = r.get("path")?;
    let filename: String = r.get("filename")?;
    let format: String = r.get("format")?;
    let size: i64 = r.get("size")?;
    let title: String = r.get("title")?;
    let authors_raw: String = r.get("authors")?;
    let series_name: Option<String> = r.get("series_name")?;
    let series_number: Option<f64> = r.get("series_number")?;
    let genres_raw: String = r.get("genres")?;
    let annotation: String = r.get("annotation")?;
    let lang: Option<String> = r.get("lang")?;
    let cover_key: Option<String> = r.get("cover_key")?;
    let publisher: Option<String> = r.get("publisher")?;
    let isbn: Option<String> = r.get("isbn")?;
    let year: Option<f64> = r.get("year")?;
    let added_at: String = r.get("added_at")?;
    let last_opened_at: Option<String> = r.get("last_opened_at")?;
    let progress_percent: Option<f64> = r.get("percent")?;
    let progress_position: Option<i64> = r.get("position")?;

    let genres: Vec<String> = if genres_raw.is_empty() {
        Vec::new()
    } else {
        genres_raw.split('\n').map(|s| s.to_owned()).collect()
    };
    let authors: Vec<Author> = authors_raw
        .split('\n')
        .filter(|l| !l.is_empty())
        .map(|l| {
            let parts: Vec<&str> = l.split('\t').collect();
            Author {
                first_name: parts.first().map(|s| s.to_string()).unwrap_or_default(),
                last_name: parts.get(1).map(|s| s.to_string()).unwrap_or_default(),
                middle_name: parts
                    .get(2)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string()),
                nickname: parts
                    .get(3)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string()),
            }
        })
        .collect();
    let series = series_name
        .filter(|n| !n.is_empty())
        .map(|name| SeriesInfo {
            name,
            number: series_number,
        });

    Ok(BookRecord {
        id,
        path,
        filename,
        format,
        size,
        title,
        authors,
        series,
        genres,
        annotation,
        lang,
        cover_key,
        publisher,
        isbn,
        year,
        added_at,
        last_opened_at,
        progress_percent,
        progress_position,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> LibraryDb {
        LibraryDb::open(":memory:").unwrap()
    }

    fn sample_metadata() -> BookMetadata {
        BookMetadata {
            title: "Test Book".to_owned(),
            authors: vec![Author {
                first_name: "John".to_owned(),
                last_name: "Doe".to_owned(),
                middle_name: None,
                nickname: None,
            }],
            series: Some(SeriesInfo {
                name: "Series".to_owned(),
                number: Some(1.0),
            }),
            genres: vec!["sf".to_owned()],
            annotation: "A test book".to_owned(),
            lang: Some("en".to_owned()),
            cover_key: Some("cover.jpg".to_owned()),
            publisher: None,
            isbn: None,
            year: Some(2020.0),
        }
    }

    #[test]
    fn open_in_memory() {
        let db = test_db();
        // :memory: DB doesn't have a file path on disk
        let _ = db;
    }

    #[test]
    fn add_and_get_book() {
        let db = test_db();
        let id = db
            .add_book(
                "/path/book.fb2",
                "book.fb2",
                "fb2",
                1024,
                &sample_metadata(),
                None,
            )
            .unwrap();
        assert!(id > 0);
        let book = db.get_book(id).unwrap().unwrap();
        assert_eq!(book.title, "Test Book");
        assert_eq!(book.authors.len(), 1);
        assert_eq!(book.authors[0].first_name, "John");
        assert_eq!(book.format, "fb2");
    }

    #[test]
    fn add_book_upsert() {
        let db = test_db();
        let id1 = db
            .add_book(
                "/path/book.fb2",
                "book.fb2",
                "fb2",
                1024,
                &sample_metadata(),
                None,
            )
            .unwrap();
        let id2 = db
            .add_book(
                "/path/book.fb2",
                "book.fb2",
                "fb2",
                2048,
                &sample_metadata(),
                None,
            )
            .unwrap();
        // Upsert: same path → same id, size updated
        assert_eq!(id1, id2);
        let book = db.get_book(id1).unwrap().unwrap();
        assert_eq!(book.size, 2048);
    }

    #[test]
    fn list_books() {
        let db = test_db();
        db.add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        db.add_book("/b.epub", "b.epub", "epub", 200, &sample_metadata(), None)
            .unwrap();
        let books = db.list_books(None, 0, "title").unwrap();
        assert_eq!(books.len(), 2);
    }

    #[test]
    fn remove_book() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        assert!(db.remove_book(id).unwrap());
        assert!(db.get_book(id).unwrap().is_none());
    }

    #[test]
    fn progress() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        db.set_progress(id, 500, 50.0).unwrap();
        let p = db.get_progress(id).unwrap().unwrap();
        assert_eq!(p.position, 500);
        assert_eq!(p.percent, 50.0);
    }

    #[test]
    fn bookmarks() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let bm_id = db.add_bookmark(id, 100, "label").unwrap();
        let bms = db.list_bookmarks(id).unwrap();
        assert_eq!(bms.len(), 1);
        assert_eq!(bms[0].label, "label");
        assert!(db.delete_bookmark(bm_id).unwrap());
        assert!(db.list_bookmarks(id).unwrap().is_empty());
    }

    #[test]
    fn get_bookmark() {
        let db = test_db();
        assert!(db.get_bookmark(1).unwrap().is_none());
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let bm_id = db.add_bookmark(id, 100, "label").unwrap();
        let bm = db.get_bookmark(bm_id).unwrap().unwrap();
        assert_eq!(bm.label, "label");
        assert_eq!(bm.book_id, id);
    }

    #[test]
    fn history() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        db.record_open(id).unwrap();
        let h = db.list_history(10).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].book_id, id);
    }

    #[test]
    fn recent_books() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        db.record_open(id).unwrap();
        let recent = db.list_recent_books(10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, id);
    }

    #[test]
    fn continue_books_excludes_untouched_and_finished() {
        let db = test_db();
        let a = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let b = db
            .add_book("/b.fb2", "b.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let c = db
            .add_book("/c.fb2", "c.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let d = db
            .add_book("/d.fb2", "d.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        db.set_progress(a, 100, 10.0).unwrap();
        db.set_progress(b, 200, 50.0).unwrap();
        db.set_progress(c, 999, 100.0).unwrap();
        db.set_progress(d, 0, 0.0).unwrap();
        db.set_progress(a, 150, 20.0).unwrap(); // bump a above b
        let ids: Vec<i32> = db
            .list_continue_books(10)
            .unwrap()
            .iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec![a, b]);
    }

    #[test]
    fn sessions() {
        let db = test_db();
        let id = db
            .add_book("/a.fb2", "a.fb2", "fb2", 100, &sample_metadata(), None)
            .unwrap();
        let sid = db.start_session(id).unwrap();
        db.end_session(sid, 5).unwrap();
        let stats = db.get_stats(id).unwrap();
        assert_eq!(stats.session_count, 1);
        assert_eq!(stats.total_pages, 5);
    }

    #[test]
    fn catalogs() {
        let db = test_db();
        db.add_catalog(
            "Gutenberg",
            "https://m.gutenberg.org/ebooks.opds/",
            None,
            None,
        )
        .unwrap();
        db.add_catalog("Flibusta", "https://flibusta.is/opds", None, None)
            .unwrap();
        let cats = db.list_catalogs().unwrap();
        assert_eq!(cats.len(), 2);
    }

    #[test]
    fn get_catalog_and_by_name() {
        let db = test_db();
        assert!(db.get_catalog(1).unwrap().is_none());
        let id = db
            .add_catalog(
                "Gutenberg",
                "https://m.gutenberg.org/ebooks.opds/",
                None,
                None,
            )
            .unwrap();
        let by_id = db.get_catalog(id).unwrap().unwrap();
        assert_eq!(by_id.name, "Gutenberg");
        let by_name = db.get_catalog_by_name("Gutenberg").unwrap().unwrap();
        assert_eq!(by_name.id, id);
        assert!(db.get_catalog_by_name("Nope").unwrap().is_none());
    }

    #[test]
    fn update_catalog_partial() {
        let db = test_db();
        let id = db
            .add_catalog("Old", "https://old/opds", Some("u"), Some("p"))
            .unwrap();
        // Partial update: only name changes, credentials stay.
        db.update_catalog(id, Some("New"), None, None, None)
            .unwrap();
        let cat = db.get_catalog(id).unwrap().unwrap();
        assert_eq!(cat.name, "New");
        assert_eq!(cat.url, "https://old/opds");
        assert_eq!(cat.username.as_deref(), Some("u"));
        assert_eq!(cat.password.as_deref(), Some("p"));
        // Credentials update only.
        db.update_catalog(id, None, None, Some("u2"), Some("p2"))
            .unwrap();
        let cat = db.get_catalog(id).unwrap().unwrap();
        assert_eq!(cat.username.as_deref(), Some("u2"));
        assert_eq!(cat.password.as_deref(), Some("p2"));
        assert_eq!(cat.name, "New");
        // No-op with no fields.
        db.update_catalog(id, None, None, None, None).unwrap();
        let cat = db.get_catalog(id).unwrap().unwrap();
        assert_eq!(cat.url, "https://old/opds");
    }

    #[test]
    fn library_folders() {
        let db = test_db();
        let id = db.add_library_folder("/home/user/books").unwrap();
        let folders = db.list_library_folders().unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, id);
        db.set_folder_scanned_at(id, 1234567890).unwrap();
        let folder = db
            .get_library_folder_by_path("/home/user/books")
            .unwrap()
            .unwrap();
        assert_eq!(folder.last_scanned_at, Some(1234567890));
    }

    #[test]
    fn remove_books_by_root() {
        let db = test_db();
        db.add_book(
            "/books/a.fb2",
            "a.fb2",
            "fb2",
            100,
            &sample_metadata(),
            Some("/books"),
        )
        .unwrap();
        db.add_book(
            "/books/b.fb2",
            "b.fb2",
            "fb2",
            100,
            &sample_metadata(),
            Some("/books"),
        )
        .unwrap();
        let n = db.remove_books_by_library_root("/books").unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn remove_books_by_paths() {
        let db = test_db();
        db.add_book(
            "/a.fb2",
            "a.fb2",
            "fb2",
            100,
            &sample_metadata(),
            Some("/books"),
        )
        .unwrap();
        db.add_book(
            "/b.fb2",
            "b.fb2",
            "fb2",
            100,
            &sample_metadata(),
            Some("/books"),
        )
        .unwrap();
        let n = db
            .remove_books_by_paths(&["/a.fb2".to_owned(), "/b.fb2".to_owned()])
            .unwrap();
        assert_eq!(n, 2);
    }
}
