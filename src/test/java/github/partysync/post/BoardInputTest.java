package github.partysync.post;

import github.partysync.category.CategoryRequest;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class BoardInputTest {
    @Test void normalizesNamesWithTheExistingUnicodePolicyAndKeepsContentNewlines() {
        var category = new CategoryRequest("  cafe\u0301 ", " description ");
        var post = new PostRequest(1L, "  cafe\u0301 ", "  Guide\n\nhttps://example.com/guide  ");
        assertThat(category.name()).isEqualTo("café");
        assertThat(post.title()).isEqualTo("café");
        assertThat(post.content()).isEqualTo("Guide\n\nhttps://example.com/guide");
    }
    @Test void validatesRequiredFieldsAndNormalizedLengthLimits() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(new PostRequest(1L, " ", "\n\t"))).hasSize(2);
            assertThat(validator.validate(new PostRequest(0L, "Title", "Body"))).hasSize(1);
            assertThat(validator.validate(new PostRequest(1L, "T".repeat(200), "B".repeat(20000)))).isEmpty();
            assertThat(validator.validate(new CategoryRequest("N".repeat(100), null))).isEmpty();
            assertThat(validator.validate(new CategoryRequest("N".repeat(101), "D".repeat(2001)))).hasSize(2);
        }
    }
}
