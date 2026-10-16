USE checktheodds;

CREATE TABLE IF NOT EXISTS bookmaker_promotion_curation (
  promotion_id BIGINT UNSIGNED NOT NULL,
  display_category VARCHAR(128) NOT NULL,
  tags JSON NOT NULL,
  display_title VARCHAR(255) NULL,
  display_subtitle VARCHAR(255) NULL,
  display_body_text TEXT NULL,
  display_image_url VARCHAR(2048) NULL,
  display_action_label VARCHAR(80) NULL,
  display_action_url VARCHAR(2048) NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (promotion_id),
  KEY ix_bookmaker_promotion_curation_public (is_published, display_order),
  CONSTRAINT fk_bookmaker_promotion_curation_promotion
    FOREIGN KEY (promotion_id) REFERENCES bookmaker_promotions (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO bookmaker_promotion_curation (
  promotion_id, display_category, tags, is_published
)
SELECT id, product_category, JSON_ARRAY(), 1
FROM bookmaker_promotions
WHERE is_active = 1;